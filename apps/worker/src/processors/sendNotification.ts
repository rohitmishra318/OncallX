import { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import axios from 'axios';
import { prisma } from '@oncallx/shared';
import type { SendNotificationJobData } from '@oncallx/shared';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'localhost',
  port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
  secure: false,
  ignoreTLS: true,
});

export async function handleSendNotification(job: Job<SendNotificationJobData>): Promise<void> {
  const { incidentId, notificationId, channel, userId, teamId } = job.data;

  // Fetch incident and user for notification content
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw new Error(`Incident ${incidentId} not found`);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`User ${userId} not found`);

  const service = await prisma.service.findUnique({ where: { id: incident.serviceId } });
  const team = await prisma.team.findUnique({ where: { id: teamId } });

  try {
    if (channel === 'email') {
      await sendEmail(incident, service?.name ?? 'Unknown', user.email, user.name);
    } else if (channel === 'slack') {
      if (!team?.slackWebhookUrl) {
        console.log(`[notification] No Slack webhook for team ${teamId}, skipping`);
        return;
      }
      await sendSlack(incident, service?.name ?? 'Unknown', team.slackWebhookUrl);
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'sent', attemptCount: { increment: 1 } },
    });
  } catch (err) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'failed', attemptCount: { increment: 1 } },
    });
    // Re-throw so BullMQ retries the job (up to 3 times with exponential backoff)
    throw err;
  }
}

interface IncidentLike {
  id: string;
  severity: string;
  status: string;
  title: string;
  createdAt: Date;
}

async function sendEmail(
  incident: IncidentLike,
  serviceName: string,
  toEmail: string,
  toName: string
): Promise<void> {
  const dashboardUrl = process.env.VITE_API_URL
    ? `${process.env.VITE_API_URL.replace(':4000', ':3000')}/incidents/${incident.id}`
    : `http://localhost:3000/incidents/${incident.id}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? 'oncallx@local.dev',
    to: `${toName} <${toEmail}>`,
    subject: `[${incident.severity}] Incident Alert: ${incident.title}`,
    text: [
      `Hello ${toName},`,
      '',
      `An incident requires your attention.`,
      ``,
      `Incident ID: ${incident.id}`,
      `Service: ${serviceName}`,
      `Severity: ${incident.severity}`,
      `Status: ${incident.status}`,
      `Created: ${incident.createdAt.toISOString()}`,
      ``,
      `View and acknowledge: ${dashboardUrl}`,
    ].join('\n'),
  });
}

async function sendSlack(
  incident: IncidentLike,
  serviceName: string,
  webhookUrl: string
): Promise<void> {
  const dashboardUrl = `http://localhost:3000/incidents/${incident.id}`;

  const body = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚨 [${incident.severity}] Incident: ${incident.title}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Service:*\n${serviceName}` },
          { type: 'mrkdwn', text: `*Severity:*\n${incident.severity}` },
          { type: 'mrkdwn', text: `*Status:*\n${incident.status}` },
          { type: 'mrkdwn', text: `*Incident ID:*\n${incident.id}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${dashboardUrl}|View incident on dashboard>`,
        },
      },
    ],
  };

  // Throw on non-2xx so BullMQ retries
  await axios.post(webhookUrl, body, { timeout: 10000 });
}
