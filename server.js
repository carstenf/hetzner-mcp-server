import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, mkdirSync, statSync, existsSync } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';

const execAsync = promisify(exec);
const app = express();
const PORT = 3000;
const SERVER_NAME = process.env.MCP_SERVER_NAME || 'mcp-server';
const SERVER_VERSION = '1.1.0';

app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

function createServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'exec',
          description: 'Execute shell command on the server',
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to execute' }
            },
            required: ['command']
          }
        },
        {
          name: 'write_file',
          description: 'Write a file to the server. Content is base64-encoded. Parent directories are created automatically. Use append=true to append instead of overwrite (for large files via chunked upload).',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Absolute path to write the file to' },
              content_base64: { type: 'string', description: 'Base64-encoded file content' },
              append: { type: 'boolean', description: 'If true, append to existing file instead of overwriting. Default: false' },
              mode: { type: 'string', description: 'Octal file mode, e.g. "0755". Default: 0644' }
            },
            required: ['path', 'content_base64']
          }
        },
        {
          name: 'read_file',
          description: 'Read a file from the server and return its content as base64. Useful for retrieving binary files or avoiding shell-escaping issues with text files.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Absolute path to the file to read' },
              max_bytes: { type: 'number', description: 'Maximum bytes to read. Default: 10485760 (10 MB)' }
            },
            required: ['path']
          }
        },
        {
          name: 'stat_file',
          description: 'Get file metadata (size, mtime, sha256 hash). Use to verify uploads or check file existence before read.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Absolute path to the file' },
              hash: { type: 'boolean', description: 'If true, compute sha256 hash. Default: false' }
            },
            required: ['path']
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'exec') {
      try {
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: '/home/carsten',
          shell: '/bin/bash',
          timeout: 30000,
          maxBuffer: 50 * 1024 * 1024
        });
        return { content: [{ type: 'text', text: stdout || stderr || 'Done' }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }
    }

    if (name === 'write_file') {
      try {
        const buf = Buffer.from(args.content_base64, 'base64');
        mkdirSync(dirname(args.path), { recursive: true });
        const opts = {};
        if (args.mode) opts.mode = parseInt(args.mode, 8);
        if (args.append) {
          writeFileSync(args.path, buf, { flag: 'a', ...opts });
        } else {
          writeFileSync(args.path, buf, opts);
        }
        const total = statSync(args.path).size;
        return {
          content: [{ type: 'text', text: `OK: ${args.append ? 'appended' : 'wrote'} ${buf.length} bytes to ${args.path} (file size now ${total} bytes)` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }
    }

    if (name === 'read_file') {
      try {
        const maxBytes = args.max_bytes || 10 * 1024 * 1024;
        const st = statSync(args.path);
        if (st.size > maxBytes) {
          return {
            content: [{ type: 'text', text: `Error: file size ${st.size} exceeds max_bytes ${maxBytes}. Use stat_file first or raise max_bytes.` }],
            isError: true
          };
        }
        const buf = readFileSync(args.path);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            path: args.path,
            size: buf.length,
            content_base64: buf.toString('base64')
          }) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }
    }

    if (name === 'stat_file') {
      try {
        if (!existsSync(args.path)) {
          return { content: [{ type: 'text', text: JSON.stringify({ path: args.path, exists: false }) }] };
        }
        const st = statSync(args.path);
        const result = {
          path: args.path,
          exists: true,
          size: st.size,
          mtime: st.mtime.toISOString(),
          mode: '0' + (st.mode & 0o777).toString(8),
          is_file: st.isFile(),
          is_dir: st.isDirectory()
        };
        if (args.hash && st.isFile()) {
          const buf = readFileSync(args.path);
          result.sha256 = createHash('sha256').update(buf).digest('hex');
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

app.all('/mcp', async (req, res) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Error' }, id: null });
    }
  }
});

app.get('/', (req, res) => res.json({ status: 'running', name: SERVER_NAME, version: SERVER_VERSION }));

app.listen(PORT, '0.0.0.0', () => console.log(`[${SERVER_NAME}] 🚀 Port ${PORT} v${SERVER_VERSION}`));
