import type { ArPoint, CvImage } from './aruco';

export const CV: {
  Image: new (width?: number, height?: number, data?: Uint8ClampedArray | number[]) => CvImage;
  adaptiveThreshold(src: CvImage, dst: CvImage, kernelSize: number, threshold: number): CvImage;
  findContours(src: CvImage, binary: number[]): ArPoint[][];
};
