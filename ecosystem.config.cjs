module.exports = {
  apps: [
    {
      name: "weedbot",
      script: "dist/index.js",
      kill_timeout: 300000,   // LLM 응답 대기 (최대 5분)
      wait_ready: false,
      listen_timeout: 10000,
    },
  ],
};
