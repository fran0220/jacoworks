import type { CapacitorConfig } from "@capacitor/cli";

const remoteChatUrl = (process.env.CAPACITOR_SERVER_URL || "https://jaco.jingao.club/chat").trim();
const cleartext = remoteChatUrl.startsWith("http://");

const config: CapacitorConfig = {
  appId: "club.jingao.jacoworks.webchat",
  appName: "JAcoworks",
  webDir: "../website/static/chat",
  server: {
    url: remoteChatUrl,
    cleartext,
    allowNavigation: [
      "jaco.jingao.club",
      "jacoapi.jingao.club",
      "localhost",
      "127.0.0.1",
    ],
  },
};

export default config;
