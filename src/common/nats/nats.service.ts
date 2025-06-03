import { Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { NATS_SERVICE } from '../../config';

export class NatsService {
  private logger = new Logger('MicroserviceUtils');

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  private isValidParams(params: Record<string, unknown>): boolean {
    return (
      params &&
      typeof params === 'object' &&
      Object.values(params).some(
        (value) => value !== null && value !== undefined,
      )
    );
  }

  async firstValue(service: string, data: any): Promise<any> {
    return firstValueFrom(
      this.client.send(service, data).pipe(
        map((response) => ({
          ...response,
          serviceStatus: true,
        })),
        catchError((error) => {
          this.logger.error(
            `Error calling microservice: ${service}`,
            error.message,
          );
          return of({
            serviceStatus: false,
            message: 'Microservice call failed',
          });
        }),
      ),
    );
  }

  async firstValueExclude(
    params: Record<string, unknown>,
    service: string,
    keysToOmit: string[],
  ): Promise<Record<string, unknown> | null> {
    if (!this.isValidParams(params)) {
      return null;
    }
    const data = await this.firstValue(service, params);
    if (!data) return null;
    keysToOmit.forEach((key) => delete data[key]);
    return data;
  }

  async firstValueInclude(
    params: Record<string, unknown>,
    service: string,
    keysToInclude: string[],
  ): Promise<Record<string, unknown> | null> {
    if (!this.isValidParams(params)) {
      return null;
    }
    const data = await this.firstValue(service, params);
    if (!data) return null;
    const filteredData = Object.fromEntries(
      keysToInclude.filter((key) => key in data).map((key) => [key, data[key]]),
    );
    return {
      ...filteredData,
      serviceStatus: data.serviceStatus,
    };
  }
}
