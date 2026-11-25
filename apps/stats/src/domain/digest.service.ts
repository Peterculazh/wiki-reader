import { Injectable } from '@nestjs/common';
import { DigestRepository } from './digest.repository.js';

@Injectable()
export class DigestService {
  constructor(private readonly digestRepo: DigestRepository) {}

  getLatest() {
    return this.digestRepo.findLatest();
  }
}
