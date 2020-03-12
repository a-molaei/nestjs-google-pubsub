import { Message, PubSub, Subscription } from '@google-cloud/pubsub';
import { Logger } from '@nestjs/common';
import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { PubSubServerOptions } from './PubSubServerOptions';
import { isError } from 'lodash';

type MessageHandler = (message: Message) => Promise<void>;

export class PubSubServer extends Server implements CustomTransportStrategy {
  public readonly logger = new Logger(PubSubServer.name);
  private readonly subscriptions: { [topicId: string]: Subscription } = {};

  private client: PubSub;

  constructor(private readonly options: PubSubServerOptions) {
    super();
  }

  listen(callback: () => void) {
    this.client = new PubSub(this.options);

    const registeredPatterns = [...this.messageHandlers.keys()];
    const subscribeAll = registeredPatterns.map(topicId => this.subscribe(topicId));

    Promise.all(subscribeAll)
      .then(() => callback())
      .catch(e => this.handleError(e));
  }

  close() {
    Object.values(this.subscriptions).forEach(sub => {
      sub.close().catch(e => this.handleError(e));
    });
  }

  protected handleError(error: any) {
    if (isError(error)) {
      super.handleError(error.stack || error.toString());
    } else {
      super.handleError(error);
    }
  }

  private async subscribe(topicId: string): Promise<void> {
    const subId = this.options.topics[topicId];
    if (!subId) {
      this.logger.error(`No subscription ID defined for topic ${topicId}`);
      return;
    }

    const sub = await this.getSubscription(topicId, subId);
    const handler = this.getMessageHandler(topicId);

    sub.on('message', handler.bind(this));
    sub.on('error', e => this.handleError(e));

    this.subscriptions[topicId] = sub;
  }

  private getMessageHandler(topicId: string): MessageHandler {
    return async (message: Message) => {
      const handler = this.getHandlerByPattern(topicId);
      if (!handler) {
        this.logger.warn(`No handler for message ${message.id}`);
        message.ack();
        return;
      }
      await handler(message);
    };
  }

  private async getSubscription(topicId: string, subId: string): Promise<Subscription> {
    const topic = this.client.topic(topicId);

    let sub = topic.subscription(subId);
    [sub] = await sub.get({ autoCreate: true });

    return sub;
  }
}
