const http = require("http");
const { Command } = require("commander");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const superagent = require("superagent");


const program = new Command();

program
  .requiredOption("-h, --host <host>", "Server host")
  .requiredOption("-p, --port <port>", "Server port")
  .requiredOption("-c, --cache <cacheDir>", "Cache directory");

program.parse(process.argv);
const options = program.opts();

const HOST = options.host;
const PORT = Number(options.port);
const CACHE_DIR = options.cache;


async function ensureCacheDir() {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
  } catch (err) {
    console.error("Cannot create cache dir:", err);
    process.exit(1);
  }
}

function getCachePath(code) {
  
  return path.join(CACHE_DIR, `${code}.jpg`);
}


function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendText(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message + "\n");
}

function sendImage(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "image/jpeg");
  res.end(data);
}



async function handleRequest(req, res) {
  const method = req.method || "GET";

  
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const code = url.pathname.slice(1); 

  if (!code) {
    return sendText(res, 400, "HTTP code is required in path, e.g. /200");
  }

  if (!["GET", "PUT", "DELETE"].includes(method)) {
    return sendText(res, 405, "Method not allowed");
  }

  const cachePath = getCachePath(code);

  if (method === "GET") {
    
    try {
      const data = await fsp.readFile(cachePath);
      return sendImage(res, 200, data);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error("Read error:", err);
        return sendText(res, 500, "Internal Server Error");
      }
      
      return fetchFromHttpCat(code, cachePath, res);
    }
  }

  if (method === "PUT") {
    const body = await readRequestBody(req);

    if (!body || body.length === 0) {
      return sendText(res, 400, "Request body is empty");
    }

    try {
      await fsp.writeFile(cachePath, body);
      return sendText(res, 201, "Created");
    } catch (err) {
      console.error("Write error:", err);
      return sendText(res, 500, "Internal Server Error");
    }
  }

  if (method === "DELETE") {
    try {
      await fsp.unlink(cachePath);
      return sendText(res, 200, "Deleted");
    } catch (err) {
      if (err.code === "ENOENT") {
        return sendText(res, 404, "Not Found");
      }
      console.error("Delete error:", err);
      return sendText(res, 500, "Internal Server Error");
    }
  }
}



async function fetchFromHttpCat(code, cachePath, res) {
  const url = `https://http.cat/${code}`;

  try {
    const response = await superagent.get(url).buffer(true);

    if (!response.ok) {
      return sendText(res, 404, "Not Found");
    }

    const data = response.body;

    try {
      await fsp.writeFile(cachePath, data);
    } catch (err) {
      console.error("Cannot save to cache:", err);
    }

    return sendImage(res, 200, data);
  } catch (err) {
    if (err.status) {
      return sendText(res, 404, "Not Found");
    }
    console.error("http.cat request error:", err);
    return sendText(res, 500, "Internal Server Error");
  }
}


async function start() {
  await ensureCacheDir();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("Unexpected error:", err);
      if (!res.headersSent) {
        sendText(res, 500, "Internal Server Error");
      } else {
        res.end();
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Proxy cache server listening at http://${HOST}:${PORT}`);
    console.log(`Cache directory: ${CACHE_DIR}`);
  });
}

start().catch((err) => {
  console.error("Startup error:", err);
  process.exit(1);
});
