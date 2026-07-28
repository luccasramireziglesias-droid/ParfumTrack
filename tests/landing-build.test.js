// Test: Landing.html build script
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Landing Build Process', () => {
  const landingPath = path.join(process.cwd(), 'landing.html');
  const sectionsDir = path.join(process.cwd(), 'src', 'landing', 'sections');
  const stylesDir = path.join(process.cwd(), 'src', 'landing', 'styles');

  // Antes este test verificaba que existiera landing.template.html, pero
  // build-landing.js nunca lo leía: armaba el <head> a mano. Comprobar la
  // existencia de un archivo huérfano no protegía nada.
  it('las fuentes reales de la landing existen (sections/ + styles/)', () => {
    expect(fs.existsSync(sectionsDir)).toBe(true);
    expect(fs.existsSync(stylesDir)).toBe(true);
    expect(fs.readdirSync(sectionsDir).length).toBeGreaterThan(0);
    expect(fs.readdirSync(stylesDir).length).toBeGreaterThan(0);
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

  it('landing.html includes all modular sections', () => {
    const landing = fs.readFileSync(landingPath, 'utf-8');
    const stylesDir = path.join(process.cwd(), 'src', 'landing', 'styles');
    const sectionsDir = path.join(process.cwd(), 'src', 'landing', 'sections');

    // Verify CSS files are included
    const cssFiles = fs.readdirSync(stylesDir).filter(f => f.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThan(0);

    // Verify section files are included
    const sectionFiles = fs.readdirSync(sectionsDir).filter(f => f.endsWith('.html'));
    expect(sectionFiles.length).toBeGreaterThan(0);

    // Verify key content from sections is present
    const keyMarkers = ['<style>', '</style>', 'announce-bar', 'nav-logo', 'hero', 'contacto', 'Mercado Pago'];
    keyMarkers.forEach(marker => {
      expect(landing).toContain(marker);
    });

    console.log(`✅ Landing.html built from ${cssFiles.length} CSS files + ${sectionFiles.length} sections`);
  });
});
