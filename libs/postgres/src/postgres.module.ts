import {
  Module,
  OnApplicationShutdown,
  Inject,
  DynamicModule,
  ModuleMetadata,
  InjectionToken,
  OptionalFactoryDependency,
} from '@nestjs/common';
import { Pool } from 'pg';

export const DB_POOL = Symbol('DB_POOL');
export const POSTGRES_OPTIONS = Symbol('POSTGRES_OPTIONS');

export type PostgresModuleOptions = {
  connectionString: string;
};

export type PostgresModuleAsyncOptions = {
  imports?: ModuleMetadata['imports'];
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: any[]) => PostgresModuleOptions | Promise<PostgresModuleOptions>;
};

const poolProvider = {
  provide: DB_POOL,
  inject: [POSTGRES_OPTIONS],
  useFactory: (options: PostgresModuleOptions) =>
    new Pool({
      connectionString: options.connectionString,
    }),
};

@Module({})
export class PostgresModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  static forRoot(options: PostgresModuleOptions): DynamicModule {
    return {
      module: PostgresModule,
      providers: [
        {
          provide: POSTGRES_OPTIONS,
          useValue: options,
        },
        poolProvider,
      ],
      exports: [poolProvider],
    };
  }

  static forRootAsync(options: PostgresModuleAsyncOptions): DynamicModule {
    return {
      module: PostgresModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: POSTGRES_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        poolProvider,
      ],
      exports: [poolProvider],
    };
  }

  async onApplicationShutdown(signal?: string) {
    await this.pool.end();
  }
}
