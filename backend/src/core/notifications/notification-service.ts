import type { LanguageCode, NotificationItem } from '@awaaz/shared';
import type { DataStore } from '../database/types';

export class NotificationService {
  constructor(private readonly store: DataStore) {}

  async notify(input: {
    organizationId: string;
    userId: string;
    caseId?: string | null;
    notificationType: string;
    title: string;
    body: string;
    language?: LanguageCode;
  }): Promise<NotificationItem> {
    return this.store.createNotification({
      organization_id: input.organizationId,
      user_id: input.userId,
      case_id: input.caseId ?? null,
      notification_type: input.notificationType,
      message: {
        title: input.title,
        body: input.body,
        language: input.language,
      },
    });
  }

  async listForUser(organizationId: string, userId: string): Promise<NotificationItem[]> {
    return this.store.listNotifications(organizationId, userId);
  }

  async markRead(organizationId: string, userId: string, notificationId: string): Promise<NotificationItem | null> {
    return this.store.markNotificationRead(organizationId, userId, notificationId);
  }
}
