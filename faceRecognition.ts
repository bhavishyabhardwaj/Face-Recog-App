import {MODEL, RECOGNITION} from '../config';
import {cosineSimilarity, l2Normalize, meanEmbedding} from '../utils/cosineSimilarity';
import {EnrolledTemplate, getTemplate} from './encryptedStorage';

export const MODEL_VERSION = 'mobilefacenet-fp16-v1';

/**
 * Recognition helpers. The actual TFLite call happens inside the Vision Camera
 * worklet (see AuthScreen / EnrollmentScreen) using react-native-fast-tflite,
 * because that's where we have the resized RGB face buffer. This module owns the
 * math around those raw embeddings: normalization, template building, matching.
 */

/**
 * Convert a raw model output tensor into a clean, L2-normalized embedding.
 * Pass the Float32Array (or number[]) returned by model.runSync(...)[0].
 */
export function toEmbedding(raw: ArrayLike<number>): number[] {
  if (raw.length !== MODEL.embeddingDim) {
    // Not fatal — log so you can fix config.embeddingDim after Netron check.
    console.warn(
      `[faceRecognition] expected ${MODEL.embeddingDim}-d embedding, got ${raw.length}`,
    );
  }
  return l2Normalize(Array.from(raw));
}

export interface MatchResult {
  matched: boolean;
  similarity: number;
  threshold: number;
}

/** Compare a live embedding against a stored template. */
export function matchEmbedding(live: number[], template: EnrolledTemplate): MatchResult {
  const similarity = cosineSimilarity(live, template.embedding);
  return {
    matched: similarity >= RECOGNITION.matchThreshold,
    similarity,
    threshold: RECOGNITION.matchThreshold,
  };
}

/** Match against a specific enrolled employee. */
export function matchEmployee(live: number[], employeeId: string): MatchResult | null {
  const tpl = getTemplate(employeeId);
  if (!tpl) return null;
  return matchEmbedding(live, tpl);
}

/** Build an averaged enrollment template from N captured embeddings. */
export function buildTemplate(employeeId: string, samples: number[][]): EnrolledTemplate {
  if (samples.length < 1) throw new Error('No enrollment samples captured.');
  return {
    employeeId,
    embedding: meanEmbedding(samples.map(l2Normalize)),
    modelVersion: MODEL_VERSION,
    createdAt: new Date().toISOString(),
  };
}

export const ENROLLMENT_SAMPLES = RECOGNITION.enrollmentSamples;
