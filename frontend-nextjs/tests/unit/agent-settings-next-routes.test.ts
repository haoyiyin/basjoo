import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../..');

const routes = [
  {
    file: 'app/(dashboard)/settings/agent/page.tsx',
    importPath: '../../../../src/views/AgentSettings',
  },
  {
    file: 'app/(dashboard)/agents/[agentId]/settings/agent/page.tsx',
    importPath: '../../../../../../src/views/AgentSettings',
  },
];

describe('Agent Settings Next.js routes', () => {
  it.each(routes)('$file exists and imports AgentSettings', ({ file, importPath }) => {
    const absolutePath = path.join(projectRoot, file);
    expect(fs.existsSync(absolutePath), `${file} should exist`).toBe(true);
    const content = fs.readFileSync(absolutePath, 'utf8');
    expect(content).toContain(importPath);
    expect(content).toContain('<AgentSettingsPage />');
  });
});