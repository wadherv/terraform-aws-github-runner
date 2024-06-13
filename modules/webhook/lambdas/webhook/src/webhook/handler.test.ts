import { Webhooks } from '@octokit/webhooks';
import { mocked } from 'jest-mock';
import nock from 'nock';

import checkrun_event from '../../test/resources/github_check_run_event.json';
import workflowjob_event from '../../test/resources/github_workflowjob_event.json';
import queuesConfig from '../../test/resources/multi_runner_configurations.json';
import { sendActionRequest } from '../sqs';
import { getParameterValue } from '../ssm';
import { handle } from './handler';

jest.mock('../sqs');
jest.mock('../ssm');

const GITHUB_APP_WEBHOOK_SECRET = 'TEST_SECRET';

const secret = 'TEST_SECRET';
const webhooks = new Webhooks({
  secret: secret,
});

const mockSQS = {
  sendMessage: jest.fn(() => {
    {
      return { promise: jest.fn() };
    }
  }),
};
jest.mock('aws-sdk', () => ({
  SQS: jest.fn().mockImplementation(() => mockSQS),
}));

describe('handler', () => {
  let originalError: Console['error'];

  beforeEach(() => {
    nock.disableNetConnect();
    process.env.REPOSITORY_WHITE_LIST = '[]';
    originalError = console.error;
    console.error = jest.fn();
    jest.clearAllMocks();
    jest.resetAllMocks();

    const mockedGet = mocked(getParameterValue);
    mockedGet.mockResolvedValueOnce(GITHUB_APP_WEBHOOK_SECRET);
  });

  afterEach(() => {
    console.error = originalError;
  });

  it('returns 500 if no signature available', async () => {
    const resp = await handle({}, '');
    expect(resp.statusCode).toBe(500);
  });

  it('returns 401 if signature is invalid', async () => {
    const resp = await handle({ 'X-Hub-Signature': 'bbb' }, 'aaaa');
    expect(resp.statusCode).toBe(401);
  });

  describe('Test for workflowjob event: ', () => {
    beforeEach(() => {
      process.env.RUNNER_CONFIG = JSON.stringify(queuesConfig);
    });
    it('handles workflow job events', async () => {
      const event = JSON.stringify(workflowjob_event);
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalled();
    });

    it('handles workflow job events with 256 hash signature', async () => {
      const event = JSON.stringify(workflowjob_event);
      const resp = await handle(
        { 'X-Hub-Signature-256': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalled();
    });

    it('does not handle other events', async () => {
      const event = JSON.stringify(workflowjob_event);
      const resp = await handle({ 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'push' }, event);
      expect(resp.statusCode).toBe(202);
      expect(sendActionRequest).not.toBeCalled();
    });

    it('does not handle workflow_job events with actions other than queued (action = started)', async () => {
      const event = JSON.stringify({ ...workflowjob_event, action: 'started' });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).not.toBeCalled();
    });

    it('does not handle workflow_job events with actions other than queued (action = completed)', async () => {
      const event = JSON.stringify({ ...workflowjob_event, action: 'completed' });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).not.toBeCalled();
    });

    it('does not handle workflow_job events from unlisted repositories', async () => {
      const event = JSON.stringify(workflowjob_event);
      process.env.REPOSITORY_WHITE_LIST = '["NotCodertocat/Hello-World"]';
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(403);
      expect(sendActionRequest).not.toBeCalled();
    });

    it('handles workflow_job events without installation id', async () => {
      const event = JSON.stringify({ ...workflowjob_event, installation: null });
      process.env.REPOSITORY_WHITE_LIST = '["philips-labs/terraform-aws-github-runner"]';
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalled();
    });

    it('handles workflow_job events from whitelisted repositories', async () => {
      const event = JSON.stringify(workflowjob_event);
      process.env.REPOSITORY_WHITE_LIST = '["philips-labs/terraform-aws-github-runner"]';
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalled();
    });

    it('Check runner labels accept test job', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'test']],
            exactMatch: true,
          },
        },
        {
          ...queuesConfig[1],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'test1']],
            exactMatch: true,
          },
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['self-hosted', 'Test'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalled();
    });

    it('Check runner labels accept job with mixed order.', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['linux', 'TEST', 'self-hosted']],
            exactMatch: true,
          },
        },
        {
          ...queuesConfig[1],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'test1']],
            exactMatch: true,
          },
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['linux', 'self-hosted', 'test'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalled();
    });

    it('Check webhook accept jobs where not all labels are provided in job.', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'test', 'test2']],
            exactMatch: true,
          },
        },
        {
          ...queuesConfig[1],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'test1']],
            exactMatch: true,
          },
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['self-hosted'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalled();
    });

    it('Check webhook does not accept jobs where not all labels are supported (single matcher).', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'x64', 'linux']],
            exactMatch: true,
          },
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['self-hosted', 'linux', 'x64', 'on-demand'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(202);
      expect(sendActionRequest).not.toBeCalled;
    });

    it('Check webhook does not accept jobs where not all labels are supported by the runner.', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'x64', 'linux', 'test']],
            exactMatch: true,
          },
        },
        {
          ...queuesConfig[1],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'x64', 'linux', 'test1']],
            exactMatch: true,
          },
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['self-hosted', 'linux', 'x64', 'test', 'gpu'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(202);
      expect(sendActionRequest).not.toBeCalled;
    });

    it('Check webhook will accept jobs with a single acceptable label.', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'test', 'test2']],
            exactMatch: true,
          },
        },
        {
          ...queuesConfig[1],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'x64']],
            exactMatch: false,
          },
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['x64'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalled();
    });

    it('Check webhook will not accept jobs without correct label when job label check all is false.', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'x64', 'linux', 'test']],
            exactMatch: false,
          },
        },
        {
          ...queuesConfig[1],
          matcherConfig: {
            labelMatchers: [['self-hosted', 'x64', 'linux', 'test1']],
            exactMatch: false,
          },
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['ubuntu-latest'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(202);
      expect(sendActionRequest).not.toBeCalled;
    });
    it('Check webhook will accept jobs for specific labels if workflow labels are specific', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['self-hosted']],
            exactMatch: false,
          },
          id: 'ubuntu-queue-id',
        },
        {
          ...queuesConfig[1],
          matcherConfig: {
            labelMatchers: [['self-hosted']],
            exactMatch: false,
          },
          id: 'default-queue-id',
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['self-hosted', 'ubuntu', 'x64', 'linux'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalledWith({
        id: workflowjob_event.workflow_job.id,
        repositoryName: workflowjob_event.repository.name,
        repositoryOwner: workflowjob_event.repository.owner.login,
        eventType: 'workflow_job',
        installationId: 0,
        queueId: 'ubuntu-queue-id',
        queueFifo: false,
      });
    });
    it('Check webhook will accept jobs for latest labels if workflow labels are not specific', async () => {
      process.env.RUNNER_CONFIG = JSON.stringify([
        {
          ...queuesConfig[0],
          matcherConfig: {
            labelMatchers: [['self-hosted']],
            exactMatch: false,
          },
          id: 'ubuntu-queue-id',
        },
        {
          ...queuesConfig[1],
          matcherConfig: {
            labelMatchers: [['self-hosted']],
            exactMatch: false,
          },
          id: 'default-queue-id',
        },
      ]);
      const event = JSON.stringify({
        ...workflowjob_event,
        workflow_job: {
          ...workflowjob_event.workflow_job,
          labels: ['self-hosted', 'linux', 'x64'],
        },
      });
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
        event,
      );
      expect(resp.statusCode).toBe(201);
      expect(sendActionRequest).toBeCalledWith({
        id: workflowjob_event.workflow_job.id,
        repositoryName: workflowjob_event.repository.name,
        repositoryOwner: workflowjob_event.repository.owner.login,
        eventType: 'workflow_job',
        installationId: 0,
        queueId: 'ubuntu-queue-id',
        queueFifo: false,
      });
    });
  });

  it('Check webhook will accept jobs when matchers accepts multiple labels.', async () => {
    process.env.RUNNER_CONFIG = JSON.stringify([
      {
        ...queuesConfig[0],
        matcherConfig: {
          labelMatchers: [
            ['self-hosted', 'arm64', 'linux', 'ubuntu-latest'],
            ['self-hosted', 'arm64', 'linux', 'ubuntu-2204'],
          ],
          exactMatch: false,
        },
        id: 'ubuntu-queue-id',
      },
    ]);
    const event = JSON.stringify({
      ...workflowjob_event,
      workflow_job: {
        ...workflowjob_event.workflow_job,
        labels: ['self-hosted', 'linux', 'arm64', 'ubuntu-latest'],
      },
    });
    const resp = await handle(
      { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'workflow_job' },
      event,
    );
    expect(resp.statusCode).toBe(201);
    expect(sendActionRequest).toBeCalledWith({
      id: workflowjob_event.workflow_job.id,
      repositoryName: workflowjob_event.repository.name,
      repositoryOwner: workflowjob_event.repository.owner.login,
      eventType: 'workflow_job',
      installationId: 0,
      queueId: 'ubuntu-queue-id',
      queueFifo: false,
    });
  });

  describe('Test for check_run is ignored.', () => {
    it('handles check_run events', async () => {
      const event = JSON.stringify(checkrun_event);
      const resp = await handle(
        { 'X-Hub-Signature': await webhooks.sign(event), 'X-GitHub-Event': 'check_run' },
        event,
      );
      expect(resp.statusCode).toBe(202);
      expect(sendActionRequest).toBeCalledTimes(0);
    });
  });
});
