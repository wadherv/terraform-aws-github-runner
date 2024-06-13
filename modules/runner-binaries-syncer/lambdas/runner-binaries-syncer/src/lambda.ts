import { Context } from 'aws-lambda';

import { logger, setContext } from './logger';
import { sync } from './syncer/syncer';

// eslint-disable-next-line
export async function handler(event: any, context: Context): Promise<void> {
  setContext(context, 'lambda.ts');
  logger.logEventIfEnabled(event);

  try {
    await sync();
  } catch (e) {
    if (e instanceof Error) {
      logger.warn(`Ignoring error: ${e.message}`);
    }
    logger.debug('Ignoring error', { error: e });
  }
}
