import { Test } from '@nestjs/testing';
import { buildAlertId } from '../../common/models/normalize-alert.model';
import type { NormalizedAlert } from '../../common/models/normalize-alert.model';
import { DatabaseModule } from '../../database/database.module';
import { DatabaseService } from '../../database/database.service';
import { AlertsModule } from './alerts.module';
import { AlertsRepository } from './alerts.repository';

function baseAlert(
  overrides: Partial<NormalizedAlert> &
    Pick<NormalizedAlert, 'id' | 'source' | 'sender' | 'msgType' | 'tier'>,
): NormalizedAlert {
  return {
    category: 'Met',
    event: 'Test Event',
    urgency: 'Immediate',
    severity: 'Severe',
    certainty: 'Observed',
    sent: new Date('2024-08-15T22:30:00.000Z'),
    areas: [
      {
        name: 'Bay',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [10, 10],
              [10, 11],
              [11, 11],
              [11, 10],
              [10, 10],
            ],
          ],
        },
      },
    ],
    lang: 'en-US',
    raw: {},
    ...overrides,
  };
}

describe('AlertsRepository lifecycle', () => {
  let repo: AlertsRepository;
  let database: DatabaseService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AlertsModule],
    }).compile();
    repo = moduleRef.get(AlertsRepository);
    database = moduleRef.get(DatabaseService);
    await database.onModuleInit();
  }, 20_000);

  beforeEach(async () => {
    await database.pool.query(`
      TRUNCATE TABLE
        notifications, watch_zones, users,
        alert_mirrors, alert_areas, alerts, sources
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it('supersedes referenced alerts on Update and cancels on Cancel', async () => {
    const sender = 'ge-monitor.example';
    const originalId = buildAlertId(
      sender,
      'storm-1',
      new Date('2024-08-15T22:30:00.000Z'),
    );
    const updateId = buildAlertId(
      sender,
      'storm-2',
      new Date('2024-08-15T23:00:00.000Z'),
    );
    const cancelId = buildAlertId(
      sender,
      'storm-3',
      new Date('2024-08-15T23:30:00.000Z'),
    );

    await repo.ingest([
      baseAlert({
        id: originalId,
        source: 'sample',
        sender,
        msgType: 'Alert',
        tier: 'A',
      }),
    ]);
    await repo.ingest([
      baseAlert({
        id: updateId,
        source: 'sample',
        sender,
        msgType: 'Update',
        tier: 'A',
        sent: new Date('2024-08-15T23:00:00.000Z'),
        references: [originalId],
      }),
    ]);

    expect((await repo.findById(originalId))?.status).toBe('superseded');
    expect(
      (await repo.list({ limit: 50, offset: 0 })).map((a) => a.id),
    ).toEqual([updateId]);

    await repo.ingest([
      baseAlert({
        id: cancelId,
        source: 'sample',
        sender,
        msgType: 'Cancel',
        tier: 'A',
        sent: new Date('2024-08-15T23:30:00.000Z'),
        references: [updateId],
      }),
    ]);

    expect((await repo.findById(updateId))?.status).toBe('cancelled');
    const active = await repo.list({ limit: 50, offset: 0 });
    expect(active.map((a) => a.id)).toEqual([cancelId]);
  });

  it('links mirrors by sender+identifier and expires due alerts', async () => {
    const sender = 'ge-monitor.example';
    const identifier = 'quake-9';
    const aId = buildAlertId(
      sender,
      identifier,
      new Date('2024-09-01T12:00:00Z'),
    );
    const bId = buildAlertId(
      sender,
      identifier,
      new Date('2024-09-01T12:00:01Z'),
    );

    await repo.ingest([
      baseAlert({
        id: aId,
        source: 'nws',
        sender,
        msgType: 'Alert',
        tier: 'A',
        event: 'Earthquake',
        sent: new Date('2024-09-01T12:00:00Z'),
        expires: new Date('2024-09-01T12:05:00Z'),
      }),
    ]);
    await repo.ingest([
      baseAlert({
        id: bId,
        source: 'wmo-alert-hub',
        sender,
        msgType: 'Alert',
        tier: 'C',
        event: 'Earthquake',
        sent: new Date('2024-09-01T12:00:01Z'),
        expires: new Date('2024-09-01T12:05:00Z'),
      }),
    ]);

    expect((await repo.findById(aId))?.mirrors).toEqual([bId]);

    const marked = await repo.expireDue(new Date('2024-09-01T12:10:00Z'));
    expect(marked).toBe(2);
    expect((await repo.findById(aId))?.status).toBe('expired');
    expect(await repo.list({ limit: 50, offset: 0 })).toEqual([]);
  });
});
