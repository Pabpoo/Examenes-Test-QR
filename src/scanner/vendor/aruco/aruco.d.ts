// Tipos mínimos del código copiado de js-aruco2 (solo lo que usa src/scanner/markers.ts).

export interface ArPoint {
  x: number;
  y: number;
}

export interface ArMarker {
  id: number;
  corners: ArPoint[];
  hammingDistance: number;
}

export interface CvImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}

export interface ArDetector {
  thres: CvImage;
  homography: CvImage;
  binary: number[];
  contours: ArPoint[][];
  findCandidates(contours: ArPoint[][], minSize: number, epsilon: number, minLength: number): ArPoint[][];
  clockwiseCorners(candidates: ArPoint[][]): ArPoint[][];
  notTooNear(candidates: ArPoint[][], minDist: number): ArPoint[][];
  findMarkers(grey: CvImage, candidates: ArPoint[][], warpSize: number): ArMarker[];
}

export const AR: {
  Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => ArDetector;
  DICTIONARIES: Record<string, { nBits: number; tau: number; codeList: number[] }>;
};
