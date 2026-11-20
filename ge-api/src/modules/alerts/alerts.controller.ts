import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.alerts.list(query);
  }

  @Post('ingest')
  @HttpCode(200)
  ingest(
    @Body() body: unknown,
    @Query('source') source?: string,
    @Query('tier') tier?: string,
  ) {
    return this.alerts.ingest(body, { source, tier });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.alerts.get(id);
  }
}
