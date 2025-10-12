# Contributing to AlphaGenome MCP

Thank you for your interest in contributing! This project is a proof-of-concept MCP server awaiting official AlphaGenome API access.

## How to Contribute

### Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include clear reproduction steps for bugs
- Specify your environment (OS, Node version, Claude Desktop version)

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make your changes** following the code style guidelines below
4. **Test your changes**: `npm run build && npm run lint`
5. **Commit with clear messages**: Follow conventional commits format
6. **Push and create a PR** with a detailed description

### Code Style Guidelines

- **TypeScript**: Use strict mode, no `any` types without justification
- **Formatting**: Run `npm run format` before committing
- **Linting**: Fix all ESLint warnings (`npm run lint:fix`)
- **Comments**: Use TSDoc format for public APIs
- **Naming**: Use descriptive names (e.g., `predictVariant` not `pred`)

### Project Structure

```
src/
├── index.ts              # Main MCP server
├── alphagenome-client.ts # API client (mock mode)
├── tools.ts              # Tool definitions
├── types.ts              # TypeScript types
└── utils/
    ├── validation.ts     # Input validation
    └── formatting.ts     # Output formatting
```

### Testing

Currently, testing is manual via Claude Desktop:
1. Build the project: `npm run build`
2. Update your `claude_desktop_config.json`
3. Restart Claude Desktop
4. Test tool functionality with natural language

Automated testing contributions are welcome!

### Development Workflow

```bash
# Setup
git clone https://github.com/taehojo/alphagenome-mcp.git
cd alphagenome-mcp
npm install

# Development
npm run dev        # Watch mode
npm run build      # Build
npm run lint:fix   # Fix linting issues
npm run format     # Format code

# Before committing
npm run typecheck  # Check types
npm run lint       # Check lint
npm test           # Run tests (when available)
```

### Areas for Contribution

1. **Real API Integration**: When AlphaGenome API is available
2. **Automated Tests**: Unit and integration tests
3. **Documentation**: More examples, tutorials
4. **Error Handling**: Improve error messages
5. **Output Formatting**: Enhance Markdown outputs
6. **New Tools**: Additional genomics analysis tools
7. **Performance**: Optimize for large batch requests

### Mock Data Policy

⚠️ **CRITICAL**: This project uses mock data for demonstration.

When contributing:
- Clearly label all mock/simulated data
- Include "⚠️ MOCK DATA" warnings in outputs
- Keep architecture ready for real API integration
- Don't present mock results as real predictions

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat(tools): add gene annotation tool`
- `fix(validation): handle edge case in chromosome validation`
- `docs(readme): update installation instructions`

### License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

- Open a GitHub Discussion for questions
- Check existing issues before creating new ones
- Be respectful and constructive in all interactions

Thank you for contributing! 🧬
