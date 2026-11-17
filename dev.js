/**
 * FindIt - 로컬 개발용 통합 서버 스크립트 (dev.js)
 * 
 * [목적]
 * - 프레임워크/번들러 없이 순수 Node.js 내장 모듈만으로 정적 파일과 api/*.js 서버리스 함수를 서빙합니다.
 * - .env.local 파일을 자동으로 파싱하여 process.env에 로드합니다.
 * - Vercel 서버리스 함수 시그니처(req, res)를 로컬에서 완벽하게 모사합니다.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 포트 설정 (기본 3000)
const PORT = process.env.PORT || 3000;

/**
 * 1. .env.local 파일 로드 및 환경변수 주입
 */
function loadEnvLocal() {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      // 주석 및 빈 줄 제외
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...vals] = trimmed.split('=');
        const val = vals.join('=').trim();
        process.env[key.trim()] = val;
      }
    });
    console.log('✅ [.env.local] 환경변수 파일이 성공적으로 로드되었습니다.');
  } else {
    console.warn('⚠️ [.env.local] 파일이 존재하지 않습니다.');
  }
}

// 환경변수 로드 실행
loadEnvLocal();

/**
 * 2. MIME 타입 매핑 표
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * 3. HTTP 서버 생성 및 요청 라우팅
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // CORS 및 기본 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Preflight OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // --- A. /api/ 서버리스 함수 라우팅 ---
  if (pathname.startsWith('/api/')) {
    const apiName = pathname.replace('/api/', '').split('?')[0];
    const apiFilePath = path.join(__dirname, 'api', `${apiName}.js`);

    if (fs.existsSync(apiFilePath)) {
      try {
        // 캐시 무효화로 코드 수정 즉시 반영
        delete require.cache[require.resolve(apiFilePath)];
        const handler = require(apiFilePath);

        // 요청 바디(Body) 버퍼 파싱 헬퍼
        let bodyBuffer = '';
        req.on('data', (chunk) => {
          bodyBuffer += chunk;
        });

        req.on('end', async () => {
          // JSON 본문 자동 파싱
          if (bodyBuffer) {
            try {
              req.body = JSON.parse(bodyBuffer);
            } catch (err) {
              req.body = bodyBuffer;
            }
          } else {
            req.body = {};
          }

          // Vercel 형식의 res.status().json() 응답 헬퍼 함수 부착
          res.status = function (statusCode) {
            this.statusCode = statusCode;
            return this;
          };
          res.json = function (data) {
            this.setHeader('Content-Type', 'application/json; charset=utf-8');
            this.end(JSON.stringify(data));
            return this;
          };

          // API 핸들러 호출
          try {
            await handler(req, res);
          } catch (handlerErr) {
            console.error(`[API 실행 오류: ${pathname}]`, handlerErr);
            if (!res.writableEnded) {
              res.status(500).json({ error: '서버 내부 오류가 발생했어요. 다시 시도해 주세요.' });
            }
          }
        });
        return;
      } catch (loadErr) {
        console.error(`[API 로드 오류]`, loadErr);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'API 모듈을 불러오지 못했어요.' }));
        return;
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '요청하신 API 엔드포인트를 찾을 수 없어요.' }));
      return;
    }
  }

  // --- B. 정적 파일(Static Files) 라우팅 ---
  if (pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = path.join(__dirname, pathname);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('페이지를 찾을 수 없어요.');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('서버 에러가 발생했어요.');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// 서버 구동 시작
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🥕 FindIt 개발 서버가 실행되었습니다!`);
  console.log(`🌐 로컬 접속 주소: http://localhost:${PORT}`);
  console.log(`⚙️ 모델: ${process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free'}`);
  console.log(`====================================================`);
});
