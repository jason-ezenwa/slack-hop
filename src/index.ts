#!/usr/bin/env node
import { main } from './cli.js';

try {
  process.exitCode = await main(process.argv.slice(2), process.env);
} catch (error) {
  // Usage and Slack errors are handled in main; anything reaching here is a bug, so keep the stack.
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
