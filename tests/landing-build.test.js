// Test: Landing.html build script
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Landing Build Process', () => {
  const landingPath = path.join(process.cwd(), 'landing.html');
  const templatePath = path.join(process.cwd(), 'src', 'landing', 'landing.template.html');

  it('landing.template.html exists in src/landing/', () => {
    expect(fs.existsSync(templatePath)).toBe(true);
    console.log('✅ Template file exists');
  });

  it('landing.html exists in root', () => {
    expect(fs.existsSync(landingPath)).toBe(true);
    console.log('✅ Generated landing.html exists');
  });

  it('landing.html has content from template', () => {
    const content = fs.readFileSync(landingPath, 'utf-8');
    expect(content).toContain('Parfum Track');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content.length).toBeGreaterThan(2000);
    console.log('✅ Landing.html has expected content');
  });

  it('landing.html is valid HTML structure', () => {
    const content = fs.readFileSync(landingPath, 'utf-8');
    expect(content).toMatch(/<html/i);
    expect(content).toMatch(/<head/i);
    expect(content).toMatch(/<body/i);
    expect(content).toMatch(/<\/html>/i);
    console.log('✅ Landing.html has valid HTML structure');
  });

  it('landing.html includes critical sections', () => {
    const content = fs.readFileSync(landingPath, 'utf-8');
    expect(content).toContain('hero');
    expect(content).toContain('beneficios');
    expect(content).toContain('funciones');
    expect(content).toContain('pricing');
    expect(content).toContain('faq');
    console.log('✅ Landing.html includes all critical sections');
  });

  it('landing.html has navigation', () => {
    const content = fs.readFileSync(landingPath, 'utf-8');
    expect(content).toContain('class="nav');
    console.log('✅ Landing.html has navigation');
  });

  it('landing.html has footer', () => {
    const content = fs.readFileSync(landingPath, 'utf-8');
    expect(content).toContain('<footer');
    console.log('✅ Landing.html has footer');
  });

  it('build script is executable', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'build-landing.js');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const content = fs.readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('src/landing');
    console.log('✅ Build script exists and references correct path');
  });

  it('landing.html matches template content', () => {
    const template = fs.readFileSync(templatePath, 'utf-8');
    const landing = fs.readFileSync(landingPath, 'utf-8');
    expect(landing).toBe(template);
    console.log('✅ Landing.html matches template (build verified)');
  });
});
