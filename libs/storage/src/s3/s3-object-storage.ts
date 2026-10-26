import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { ObjectStorage, PutOptions, StoredObject } from '../ports.js';
import {
  S3_CLIENT,
  STORAGE_OPTIONS,
  type StorageModuleOptions,
} from './client.js';

@Injectable()
export class S3ObjectStorage
  extends ObjectStorage
  implements OnModuleInit, OnModuleDestroy
{
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    @Inject(STORAGE_OPTIONS) private readonly options: StorageModuleOptions,
  ) {
    super();
    this.bucket = options.bucket;
  }

  async onModuleInit() {
    if (!this.options.createBucket) return;
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const exists =
        error instanceof S3ServiceException &&
        (error.name === 'BucketAlreadyOwnedByYou' ||
          error.name === 'BucketAlreadyExists');
      if (!exists) throw error;
    }
  }

  onModuleDestroy() {
    this.client.destroy();
  }

  async put(
    key: string,
    body: string | Uint8Array,
    options: PutOptions = {},
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        body: await response.Body!.transformToByteArray(),
        contentType: response.ContentType,
      };
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) keys.push(object.Key!);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
