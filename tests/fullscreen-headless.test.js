import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Demo modal fullscreen functionality', () => {
  it('should have expand button with proper event handlers', () => {
    // Read the built HTML
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Verify HTML structure
    expect(html).toContain('id="modal-demo"');
    expect(html).toContain('id="demo-video"');
    expect(html).toContain('id="modal-demo-content"');
    expect(html).toContain('App.expandDemoVideo()');
    expect(html).toContain('Pantalla completa');

    console.log('✓ HTML structure is correct');
  });

  it('should have expandDemoVideo method for modal expansion', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Extract the expandDemoVideo method
    const methodMatch = html.match(/expandDemoVideo\(\)\s*\{[\s\S]*?\n\s*\},/);
    expect(methodMatch).toBeTruthy();

    const methodCode = methodMatch[0];

    // Verify it handles modal expansion
    expect(methodCode).toContain('classList');
    expect(methodCode).toContain('expanded');
    expect(methodCode).toContain('100vh');
    expect(methodCode).toContain('100vw');
    expect(methodCode).toContain('style');

    console.log('✓ expandDemoVideo method properly expands modal');
  });

  it('should have demo modal with correct event propagation', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Find modal-demo structure
    const modalMatch = html.match(/id="modal-demo"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    expect(modalMatch).toBeTruthy();

    const modalCode = modalMatch[0];

    // Verify modal structure
    expect(modalCode).toContain('modal-overlay');
    expect(modalCode).toContain('onclick="App.closeDemoModal()"');
    expect(modalCode).toContain('modal-content');
    expect(modalCode).toContain('onclick="event.stopPropagation()"');
    expect(modalCode).toContain('demo-video');

    // Verify buttons
    expect(modalCode).toContain('onclick="event.stopPropagation(); event.preventDefault(); App.expandDemoVideo();"');
    expect(modalCode).toContain('onclick="event.stopPropagation(); App.closeDemoModal();"');

    console.log('✓ Modal structure and event handlers are correct');
  });

  it('should have required button onclick handlers verified', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Count the fullscreen buttons (should be at least 1 in app)
    const fullscreenMatches = html.match(/Pantalla completa/g);
    expect(fullscreenMatches && fullscreenMatches.length >= 1).toBe(true);

    console.log(`✓ Found ${fullscreenMatches?.length || 0} expand button(s)`);

    // Verify the button calls expandDemoVideo
    const expandButtonMatch = html.match(/App\.expandDemoVideo\(\)/);
    expect(expandButtonMatch).toBeTruthy();

    console.log('✓ Expand button has correct onclick handler');
  });

  it('should verify expand method is callable and defined', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Extract script content
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();

    const scriptContent = scriptMatch[1];

    // Verify expandDemoVideo is defined
    expect(scriptContent).toContain('expandDemoVideo()');

    // Verify it's part of the App object
    expect(scriptContent).toMatch(/expandDemoVideo\s*\(\s*\)\s*\{/);

    // Verify the method handles modal expansion
    expect(scriptContent).toContain('document.getElementById(\'modal-demo-content\')');
    expect(scriptContent).toContain('classList');
    expect(scriptContent).toContain('expanded');

    console.log('✓ expandDemoVideo method is properly defined with modal handling');
  });

  it('should have closeDemoModal method that resets modal state', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Extract script content
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    const scriptContent = scriptMatch[1];

    // Find closeDemoModal method
    const closeMatch = scriptContent.match(/closeDemoModal\(\)\s*\{[\s\S]*?\n\s*\},/);
    expect(closeMatch).toBeTruthy();

    const closeCode = closeMatch[0];

    // Verify it resets modal state
    expect(closeCode).toContain('modal');
    expect(closeCode).toContain('hidden');
    expect(closeCode).toContain('pause');
    expect(closeCode).toContain('classList');

    console.log('✓ closeDemoModal method properly resets modal state');
  });
});
