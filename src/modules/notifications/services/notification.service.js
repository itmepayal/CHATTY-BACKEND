/**
 * Notification Service
 * Domain service for managing push/in-app notifications, preferences, and delivery.
 */

export const sendNotification = async ({
  userId,
  type,
  title,
  body,
  data = {},
}) => {
  return {
    delivered: true,
    userId,
    type,
    timestamp: new Date(),
  };
};

export const getNotificationPreferences = async (userId) => {
  return {
    userId,
    soundEnabled: true,
    pushEnabled: true,
    emailAlerts: false,
  };
};

export default {
  sendNotification,
  getNotificationPreferences,
};
