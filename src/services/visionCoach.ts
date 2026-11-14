import type { EyeContactState, QuestionVisionSummary, VisionFrameSample } from '../types/interview';

const MEDIAPIPE_ESM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm';
const MEDIAPIPE_WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

interface FaceLandmarkerResult {
  faceLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
  faceBlendshapes?: Array<{ categories: BlendshapeCategory[] }>;
  facialTransformationMatrixes?: Array<{ data: Float32Array | number[] }>;
}

interface FaceLandmarkerInstance {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => FaceLandmarkerResult;
  close: () => void;
}

let cachedLandmarkerPromise: Promise<FaceLandmarkerInstance> | null = null;

export async function getFaceLandmarker(): Promise<FaceLandmarkerInstance> {
  if (cachedLandmarkerPromise) {
    return cachedLandmarkerPromise;
  }

  cachedLandmarkerPromise = (async () => {
    const visionModule = (await import(/* @vite-ignore */ MEDIAPIPE_ESM_URL)) as {
      FilesetResolver: {
        forVisionTasks: (wasmPath: string) => Promise<unknown>;
      };
      FaceLandmarker: {
        createFromOptions: (
          fileset: unknown,
          options: Record<string, unknown>
        ) => Promise<FaceLandmarkerInstance>;
      };
    };

    const filesetResolver = await visionModule.FilesetResolver.forVisionTasks(
      MEDIAPIPE_WASM_ROOT
    );

    return visionModule.FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  })().catch((err) => {
    cachedLandmarkerPromise = null;
    throw err;
  });

  return cachedLandmarkerPromise;
}

export interface LiveVisionTelemetry {
  faceDetected: boolean;
  eyeContactState: EyeContactState;
  eyeContactPct: number;
  smilePct: number;
  headStabilityScore: number;
  yawDeg: number;
  pitchDeg: number;
  lowEyeContactDurationSec: number;
}

export function evaluateVisionFrame(
  landmarker: FaceLandmarkerInstance,
  video: HTMLVideoElement,
  timestampMs: number
): VisionFrameSample {
  const result = landmarker.detectForVideo(video, timestampMs);
  const landmarks = result.faceLandmarks?.[0];

  if (!landmarks || landmarks.length === 0) {
    return {
      timestamp: timestampMs,
      faceDetected: false,
      yawDeg: 0,
      pitchDeg: 0,
      eyeContact: false,
      smileScore: 0,
      noseX: 0.5,
      noseY: 0.5,
    };
  }

  // Extract yaw & pitch from 4x4 facial transformation matrix (column-major)
  let yawDeg = 0;
  let pitchDeg = 0;
  const matrixData = result.facialTransformationMatrixes?.[0]?.data;
  if (matrixData && matrixData.length >= 11) {
    const r02 = matrixData[8];
    const r12 = matrixData[9];
    const r22 = matrixData[10];
    yawDeg = Math.atan2(r02, r22) * (180 / Math.PI);
    pitchDeg = Math.atan2(-r12, Math.hypot(r02, r22)) * (180 / Math.PI);
  }

  // Blendshape extraction for gaze neutrality & smile
  const categories = result.faceBlendshapes?.[0]?.categories ?? [];
  const blendMap = new Map<string, number>();
  for (const cat of categories) {
    blendMap.set(cat.categoryName, cat.score);
  }

  const gazeDeviations = [
    blendMap.get('eyeLookOutLeft') ?? 0,
    blendMap.get('eyeLookOutRight') ?? 0,
    blendMap.get('eyeLookInLeft') ?? 0,
    blendMap.get('eyeLookInRight') ?? 0,
    blendMap.get('eyeLookUpLeft') ?? 0,
    blendMap.get('eyeLookUpRight') ?? 0,
    blendMap.get('eyeLookDownLeft') ?? 0,
    blendMap.get('eyeLookDownRight') ?? 0,
  ];
  const maxGazeDeviation = Math.max(...gazeDeviations);
  const neutralEyeBlendshapes = maxGazeDeviation < 0.45;

  const headWithinThreshold = Math.abs(yawDeg) <= 15 && Math.abs(pitchDeg) <= 15;
  const eyeContact = headWithinThreshold && neutralEyeBlendshapes;

  const smileLeft = blendMap.get('mouthSmileLeft') ?? 0;
  const smileRight = blendMap.get('mouthSmileRight') ?? 0;
  const smileScore = (smileLeft + smileRight) / 2;

  // Nose tip landmark index 1
  const nose = landmarks[1] ?? landmarks[0];

  return {
    timestamp: timestampMs,
    faceDetected: true,
    yawDeg: Number(yawDeg.toFixed(1)),
    pitchDeg: Number(pitchDeg.toFixed(1)),
    eyeContact,
    smileScore,
    noseX: nose.x,
    noseY: nose.y,
  };
}

export function computeHeadStability(samples: VisionFrameSample[]): number {
  const detected = samples.filter((s) => s.faceDetected);
  if (detected.length < 3) return 85;

  const meanX = detected.reduce((acc, s) => acc + s.noseX, 0) / detected.length;
  const meanY = detected.reduce((acc, s) => acc + s.noseY, 0) / detected.length;

  const variance =
    detected.reduce(
      (acc, s) => acc + Math.pow(s.noseX - meanX, 2) + Math.pow(s.noseY - meanY, 2),
      0
    ) / detected.length;

  const stdDev = Math.sqrt(variance);
  // Typical steady posture stdDev ~ 0.005–0.02; excessive swaying > 0.08
  const rawScore = 100 - Math.max(0, (stdDev - 0.008) * 1100);
  return Math.round(Math.max(25, Math.min(100, rawScore)));
}

export function summarizeQuestionVision(
  questionId: string,
  samples: VisionFrameSample[]
): QuestionVisionSummary | null {
  if (samples.length === 0) return null;

  const detected = samples.filter((s) => s.faceDetected);
  if (detected.length === 0) {
    return {
      questionId,
      sampleCount: samples.length,
      faceDetectedCount: 0,
      eyeContactPct: 0,
      smilePct: 0,
      headStabilityScore: 0,
      presenceScore: 0,
    };
  }

  const eyeContactCount = detected.filter((s) => s.eyeContact).length;
  const eyeContactPct = Math.round((eyeContactCount / samples.length) * 100);

  const smilingFrames = detected.filter((s) => s.smileScore >= 0.22).length;
  const smilePct = Math.round((smilingFrames / detected.length) * 100);

  const headStabilityScore = computeHeadStability(detected);

  // Warm natural expression target around 25-60% smiling; don't penalize calm focus
  const smileComponent = Math.min(100, 45 + smilePct * 0.9);
  const presenceScore = Math.round(
    eyeContactPct * 0.55 + headStabilityScore * 0.3 + smileComponent * 0.15
  );

  return {
    questionId,
    sampleCount: samples.length,
    faceDetectedCount: detected.length,
    eyeContactPct,
    smilePct,
    headStabilityScore,
    presenceScore: Math.max(0, Math.min(100, presenceScore)),
  };
}
