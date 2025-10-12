# 🧬 AlphaGenome MCP Server

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

**MCP server for AI-powered genomic variant analysis using Google DeepMind's AlphaGenome**

> ✅ **Real AlphaGenome API Integration**: This server uses Google DeepMind's AlphaGenome Python SDK to provide AI-powered genomic variant analysis through Claude Desktop.

---

## ✨ Features

- 🧬 **Variant Impact Prediction** - Analyze how genetic variants affect gene regulation
- 🔍 **Regulatory Element Discovery** - Identify promoters, enhancers, and transcription factor binding sites
- 📊 **Batch Variant Scoring** - Prioritize hundreds of variants at scale
- 💬 **Natural Language Interface** - No coding required, just ask Claude in plain English
- ⚡ **Lightning Fast** - Get results in seconds using AlphaGenome AI
- 🔬 **Research Grade** - Powered by Google DeepMind's state-of-the-art genomics AI

---

## 🚀 Quick Start

### Prerequisites

1. **Node.js** 18+ - For the MCP server
2. **Python 3** - For AlphaGenome API
3. **Claude Desktop** - For the chat interface
4. **AlphaGenome API Key** - Get from [Google DeepMind](https://deepmind.google)

### Installation

#### Step 1: Install Python Dependencies

```bash
pip install alphagenome numpy
```

#### Step 2: Install MCP Server

```bash
# Via npx (recommended - no installation needed)
npx @jolab/alphagenome-mcp

# Or install globally
npm install -g @jolab/alphagenome-mcp
```

#### Step 3: Configure Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp"],
      "env": {
        "ALPHAGENOME_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Or use the Claude MCP command:

```bash
claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp --api-key YOUR_API_KEY
```

#### Step 4: Restart Claude Desktop

Completely quit and restart Claude Desktop to load the new MCP server.

---

## 💡 Usage Examples

### 🧬 Basic Variant Analysis

```
"Use AlphaGenome to analyze the variant chr17:41234567A>T"
```

### 🔍 Find Regulatory Elements

```
"What regulatory elements are in the region chr11:5225464-5227071?"
```

### 📊 Batch Analysis

```
"Score these variants by regulatory impact:
- chr7:117199563C>T
- chr13:32910000G>A
- chr19:1220000A>C
Show me the top 3"
```

---

## 🛠️ For Developers

### Local Development

```bash
# Clone repository
git clone https://github.com/taehojo/alphagenome-mcp.git
cd alphagenome-mcp

# Install dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt

# Build TypeScript
npm run build

# Run locally with your API key
ALPHAGENOME_API_KEY=your-key-here node build/index.js
```

### Project Structure

```
alphagenome-mcp/
├── src/
│   ├── index.ts              # Main MCP server
│   ├── alphagenome-client.ts # API client (Python bridge)
│   ├── tools.ts              # MCP tool definitions
│   ├── types.ts              # TypeScript types
│   └── utils/
│       ├── validation.ts     # Input validation
│       └── formatting.ts     # Output formatting
├── scripts/
│   └── alphagenome_bridge.py # Python bridge to AlphaGenome API
├── docs/                     # Documentation
├── build/                    # Compiled TypeScript
└── requirements.txt          # Python dependencies
```

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file

Copyright (c) 2025 Taeho Jo

---

## 🙏 Acknowledgments

- **[AlphaGenome](https://deepmind.google/discover/blog/alphagenome/)** - Google DeepMind's genomic AI (inspiration)
- **[Model Context Protocol](https://modelcontextprotocol.io/)** - Anthropic's protocol for AI tool integration
- **[Claude](https://claude.ai/)** - Anthropic's AI assistant

---

## 📬 Contact & Support

- **Issues**: [GitHub Issues](https://github.com/taehojo/alphagenome-mcp/issues)
- **Email**: taehjo@gmail.com
- **GitHub**: [@taehojo](https://github.com/taehojo)

---

**Made with ❤️ for the genomics research community**

*Powered by Google DeepMind's AlphaGenome AI*
