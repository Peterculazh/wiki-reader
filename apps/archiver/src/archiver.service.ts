import { Injectable } from '@nestjs/common';

@Injectable()
export class ArchiverService {
  getHello(): string {
    return 'Hello World!';
  }
}
