import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zogby.caddystack",
  appName: "Caddy Stack",
  webDir: "dist-native",
  backgroundColor: "#08110c",
  android: {
    backgroundColor: "#08110c",
    allowMixedContent: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#08110c",
    },
  },
};

export default config;
