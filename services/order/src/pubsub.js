async function publishOrderPlaced(eventPayload) {
  const topicName = process.env.PUBSUB_TOPIC;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const notificationUrl = process.env.NOTIFICATION_URL;

  if (!topicName) {
    console.log('[order] order.placed event (local):', JSON.stringify(eventPayload));

    if (notificationUrl) {
      const base64Data = Buffer.from(JSON.stringify(eventPayload)).toString('base64');
      try {
        await fetch(`${notificationUrl.replace(/\/+$/, '')}/pubsub`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              data: base64Data,
              messageId: `local-${Date.now()}`
            },
            subscription: 'projects/local/subscriptions/order-placed-push'
          })
        });
      } catch (err) {
        console.error(`[order] Failed to push event to NOTIFICATION_URL: ${err.message}`);
      }
    }

    return { mode: 'log' };
  }

  const { PubSub } = require('@google-cloud/pubsub');
  const pubsub = new PubSub(projectId ? { projectId } : {});
  const topic = pubsub.topic(topicName);
  const dataBuffer = Buffer.from(JSON.stringify(eventPayload));
  const messageId = await topic.publishMessage({
    data: dataBuffer,
    attributes: { eventType: 'order.placed' }
  });

  return { mode: 'pubsub', messageId };
}

module.exports = { publishOrderPlaced };
