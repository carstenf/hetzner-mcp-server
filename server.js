import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  InitializeRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
const PORT = 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const server = new Server(
  { name: 'hetzner-ssh', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(InitializeRequestSchema, async () => {
  console.log('[MCP] ✅ Initialize');
  return {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'hetzner-ssh', version: '1.0.0' }
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.log('[MCP] ✅ ListTools');
  return {
    tools: [{
      name: 'exec',
      description: 'Execute shell command on Hetzner server',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' }
        },
        required: ['command']
      }
    }]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.log('[MCP] ✅ CallTool:', request.params.name);
  const { name, arguments: args } = request.params;
  
  if (name === 'exec') {
    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: '/home/carsten',
        shell: '/bin/bash',
        timeout: 30000
      });
      return {
        content: [{ type: 'text', text: stdout || stderr || 'Done' }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
  
  throw new Error(`Unknown tool: ${name}`);
});

// MCP endpoint - Create fresh transport per request
app.all('/mcp', async (req, res) => {
  console.log('[HTTP]', req.method);
  
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    
    res.on('close', () => transport.close());
    
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    
    console.log('[HTTP] ✅');
  } catch (error) {
    console.error('[HTTP] ❌', error.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Error' },
        id: null
      });
    }
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'running' });
});

app.listen(PORT, () => {
  console.log(`[Server] 🚀 Port ${PORT}`);
});
