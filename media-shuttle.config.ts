export default () => ({
  mediaShuttle: {
    url: process.env.MEDIA_SHUTTLE_URL,
    username: process.env.MEDIA_SHUTTLE_USERNAME,
    password: process.env.MEDIA_SHUTTLE_PASSWORD,
    recipientEmail: process.env.MEDIA_SHUTTLE_RECIPIENT_EMAIL,
    timeout: Number(process.env.MEDIA_SHUTTLE_TIMEOUT) || 30000,
    headless: process.env.MEDIA_SHUTTLE_HEADLESS === "true",
    maxRetries: Number(process.env.MEDIA_SHUTTLE_MAX_RETRIES) || 3,
    screenshotOnError: process.env.MEDIA_SHUTTLE_SCREENSHOT_ON_ERROR === "true",
  },
});
