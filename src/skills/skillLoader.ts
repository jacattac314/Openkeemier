/**
 * Dynamic lazy-loaded skill system.
 * Skills are defined as SKILL.md files with YAML frontmatter + markdown instructions.
 * Only loaded when referenced, preserving context window limits.
 */

import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  filePath: string;
}

interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
}

const SKILLS_DIR = join(process.cwd(), 'src', 'skills', 'definitions');
const skillCache = new Map<string, Skill>();
let skillIndex: Skill[] | null = null;

/** Load all skill metadata (frontmatter only) for indexing. */
export async function loadSkillIndex(): Promise<Skill[]> {
  if (skillIndex) return skillIndex;

  if (!existsSync(SKILLS_DIR)) {
    logger.debug('Skills definitions directory not found, no skills loaded');
    return [];
  }

  const files = await readdir(SKILLS_DIR);
  const skillFiles = files.filter((f) => f.endsWith('.md'));

  const skills: Skill[] = [];
  for (const file of skillFiles) {
    const filePath = join(SKILLS_DIR, file);
    const skill = await parseSkillFile(filePath);
    if (skill) skills.push(skill);
  }

  skillIndex = skills;
  logger.info({ count: skills.length }, 'Skill index loaded');
  return skills;
}

/** Find skills that match a user message. Returns matching skills sorted by relevance. */
export async function findMatchingSkills(userMessage: string): Promise<Skill[]> {
  const index = await loadSkillIndex();
  const lowerMsg = userMessage.toLowerCase();

  return index.filter((skill) =>
    skill.triggers.some((trigger) => lowerMsg.includes(trigger.toLowerCase()))
  );
}

/** Load the full instructions for a specific skill (lazy-loaded). */
export async function loadSkillInstructions(skillName: string): Promise<string | null> {
  const index = await loadSkillIndex();
  const skill = index.find((s) => s.name === skillName);

  if (!skill) {
    logger.warn({ skillName }, 'Skill not found');
    return null;
  }

  if (skillCache.has(skillName)) {
    return skillCache.get(skillName)!.instructions;
  }

  const loaded = await parseSkillFile(skill.filePath);
  if (loaded) {
    skillCache.set(skillName, loaded);
    return loaded.instructions;
  }

  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function parseSkillFile(filePath: string): Promise<Skill | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const { frontmatter, body } = extractFrontmatter(content);

    if (!frontmatter.name || !frontmatter.description) {
      logger.warn({ filePath }, 'Skill file missing required frontmatter fields');
      return null;
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      triggers: frontmatter.triggers ?? [],
      instructions: body.trim(),
      filePath,
    };
  } catch (err) {
    logger.error({ filePath, err }, 'Failed to parse skill file');
    return null;
  }
}

function extractFrontmatter(content: string): {
  frontmatter: Partial<SkillFrontmatter>;
  body: string;
} {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);

  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const [, yamlStr = '', body = ''] = frontmatterMatch;

  // Simple YAML parser for the frontmatter (avoids heavy dependency)
  const frontmatter: Partial<SkillFrontmatter> = {};
  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'name' || key === 'description') {
      frontmatter[key] = value.replace(/^["']|["']$/g, '');
    } else if (key === 'triggers') {
      // Parse YAML array: "- item" format
      const items = yamlStr
        .split('\n')
        .filter((l) => l.trim().startsWith('- '))
        .map((l) => l.trim().slice(2).trim());
      frontmatter.triggers = items;
    }
  }

  return { frontmatter, body };
}
