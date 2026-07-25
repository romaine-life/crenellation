const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const bakedServer = path.join(__dirname, 'server.js');
const bakedFrontendDir = process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend', 'dist');
const staticFrontendDir = process.env.STATIC_FRONTEND_DIR || '/var/run/chess-tactics-static-override';
const hotBackendDir = process.env.HOT_BACKEND_DIR || '/var/run/chess-tactics-hot';
const hotServer = path.join(hotBackendDir, 'server.js');
const nodePath = process.env.NODE_PATH || path.join(__dirname, 'node_modules');

let child = null;
let stopping = false;
let restarting = false;
let killTimer = null;

function ensureHotPaths() {
  fs.mkdirSync(hotBackendDir, { recursive: true });
  fs.mkdirSync(staticFrontendDir, { recursive: true });
  if (!fs.existsSync(hotServer)) {
    fs.copyFileSync(bakedServer, hotServer);
  }
}

function childEnv() {
  return {
    ...process.env,
    FRONTEND_DIR: bakedFrontendDir,
    STATIC_FRONTEND_DIR: staticFrontendDir,
    NODE_PATH: nodePath,
  };
}

function startChild() {
  ensureHotPaths();
  child = spawn(process.execPath, [hotServer], {
    cwd: path.dirname(hotServer),
    env: childEnv(),
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }

    if (stopping) {
      const exitCode = code === null ? 0 : code;
      process.exit(exitCode);
      return;
    }

    if (restarting) {
      restarting = false;
      startChild();
      return;
    }

    console.error(`chess-tactics child exited unexpectedly: code=${code} signal=${signal}`);
    setTimeout(startChild, 1000);
  });
}

function terminateChild(signal) {
  if (!child || child.exitCode !== null) return false;
  child.kill(signal);
  killTimer = setTimeout(() => {
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }, 5000);
  return true;
}

function restartChild() {
  if (restarting) return;
  restarting = true;
  if (!terminateChild('SIGTERM')) {
    restarting = false;
    startChild();
  }
}

function stop(signal) {
  stopping = true;
  if (!terminateChild(signal)) {
    process.exit(0);
  }
}

process.on('SIGHUP', restartChild);
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

startChild();
