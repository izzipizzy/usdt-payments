import { type ArgumentMetadata, type PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') return value;
    const res = this.schema.safeParse(value);
    if (!res.success) throw new UnprocessableEntityException({ message: 'validation failed', issues: res.error.issues });
    return res.data;
  }
}
