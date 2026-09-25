# Contributing to AlphaGenome MCP

Thank you for your interest in contributing! This MCP server calls the real AlphaGenome API through the AlphaGenome Python SDK (`alphagenome` 0.9.0 or newer): the precomputed AlphaGenome Atlas for single-nucleotide variants and live inference for everything else. Nothing is mocked.

## How to Contribute

### Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include clear reproduction steps for bugs
- Specify your environment (OS, Node version, Claude Desktop version)

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make your changes** following the code style guidelines below
4. **Test your changes**: `npm run lint && npm run typecheck && npm test` (and `npm run test:python` if you changed `scripts/`)
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
├── index.ts              # MCP server entry point
├── alphagenome-client.ts # API client (Python bridge, timeout, interpreter choice)
├── routing.ts            # Atlas or live inference: the rule, as pure functions
├── variant-tools.ts      # The 20 variant tools, over two primitives and a narrow backend interface
├── tools.ts              # MCP tool definitions (docs/API.md is generated from it)
├── types.ts              # TypeScript types and error classes
├── tests/                # Unit tests (no API key needed)
└── utils/
    ├── config.ts         # Environment variables
    ├── validation.ts     # Input validation (Zod schemas)
    └── formatting.ts     # Output formatting
scripts/
├── alphagenome_bridge.py # Dispatcher between Node and the AlphaGenome SDK
├── atlas_actions.py      # AlphaGenome Atlas queries
├── live_actions.py       # Live inference with score_variant
├── summaries.py          # Summarizer shared by both sources
└── tests/                # Python unit tests (numpy and pandas only, no SDK)
```

### Testing

The unit tests need no API key:

- `npm test` builds the project and runs the TypeScript tests. Every variant tool is tested with a fake scoring backend.
- `npm run test:python` runs the Python tests of the shared summarizer.
- `npm run docs:api:check` fails if `docs/API.md` is out of date with `src/tools.ts`; regenerate it with `npm run docs:api`.

To try the server end to end you need a real AlphaGenome API key (https://deepmind.google.com/science/alphagenome) and Python 3.10+ with `alphagenome` installed:
1. Build the project: `npm run build`
2. Add the server to your MCP client (see the README), with `ALPHAGENOME_API_KEY` in its `env` block
3. Restart the client
4. Test tool functionality with natural language, and check the `source` line of each result

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
npm test           # Build and run the unit tests
npm run test:python  # Python summarizer tests
```

### Areas for Contribution

1. **Tests**: More unit tests with the fake backend, and Python summarizer tests
2. **SDK updates**: Keep the bridge in step with new `alphagenome` releases
3. **Documentation**: More examples, tutorials
4. **Error Handling**: Improve error messages
5. **Output Formatting**: Enhance Markdown outputs
6. **New Tools**: Additional genomics analysis tools
7. **Performance**: Optimize for large batch requests

### Results Policy

Every result comes from the real AlphaGenome API and states its source (`atlas`, `live`, or `live (atlas fallback: <reason>)`).

When contributing:
- Do not add mocked, simulated or placeholder scores to tool output
- Report scores and calibrated quantiles as returned; do not add thresholds that turn a score into a pathogenicity class, risk label, impact level or percent change (the `FORBIDDEN` list in `src/tests/fixtures.ts` makes the tests fail if such words appear in a result)
- Keep the statement that results are research predictions, not clinical classifications

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
