import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { logger } from './utils/logger';
import { connectRedis } from './services/geoip';
import { initClamAV } from './middleware/virusScan';
import { generateHoneypotTokens } from './utils/honeypot';

import authRoutes from './routes/auth';
import uploadRoutes from './routes/upload';
import viewRoutes from './routes/view';
import otpRoutes from './routes/otp';
import dashboardRoutes from './routes/dashboard';
import adminRoutes from './routes/admin';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Behind Railway/Vercel/etc. the first hop is the platform proxy; without this,
// req.ip is the proxy address, rate limits lump all users into one bucket, and
// req.protocol/host (used for playlist URLs) are wrong.
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true,
    frameguard: { action: 'deny' },
  })
);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/view', viewRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

async function start(): Promise<void> {
  await connectRedis();
  await initClamAV();
  await generateHoneypotTokens();

  app.listen(PORT, () => {
    logger.info(`SecureShare backend listening on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { error: String(err) });
  process.exit(1);
});

export default app;
