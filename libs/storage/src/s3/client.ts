import { S3Client } from '@aws-sdk/client-s3';

export type StorageModuleOptions = {
  bucket: string;
  /** S3-compatible endpoint such as SeaweedFS (`http://localhost:8333`). Omit for AWS. */
  endpoint?: string;
  region?: string;
  /** Omit to use the SDK's default chain (env, profile, instance role). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Create the bucket on startup if it is missing. Meant for local dev. */
  createBucket?: boolean;
};

export const STORAGE_OPTIONS = Symbol('STORAGE_OPTIONS');
export const S3_CLIENT = Symbol('S3_CLIENT');

export function createS3Client(options: StorageModuleOptions): S3Client {
  const custom = options.endpoint !== undefined;
  return new S3Client({
    region: options.region ?? 'us-east-1',
    endpoint: options.endpoint,
    credentials: options.credentials,
    // S3-compatible servers serve buckets under the path, not a subdomain
    forcePathStyle: custom,
    // The SDK's default CRC checksums aren't understood by every S3-compatible server
    ...(custom && {
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  });
}
