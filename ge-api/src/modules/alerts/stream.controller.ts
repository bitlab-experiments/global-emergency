import { Controller, Sse } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { fromEvent, map, Observable } from 'rxjs';

@Controller()
export class StreamController {
  constructor(private readonly eventEmitter: EventEmitter2) {}
  
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return fromEvent(this.eventEmitter, 'alerts.ingested').pipe(
      map((alerts) => ({
        data: alerts,
      }) as MessageEvent),
    );
  }

}
