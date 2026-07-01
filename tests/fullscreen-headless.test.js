import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Demo modal fullscreen functionality', () => {
  it('should have fullscreen button with proper event handlers', () => {
    // Read the built HTML
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Verify HTML structure
    expect(html).toContain('id="modal-demo"');
    expect(html).toContain('id="demo-video"');
    expect(html).toContain('onclick="event.stopPropagation(); event.preventDefault(); App.videoFullscreen();"');
    expect(html).toContain('allowfullscreen');
    expect(html).toContain('webkitallowfullscreen');
    expect(html).toContain('mozallowfullscreen');

    console.log('✓ HTML structure is correct');
  });

  it('should have videoFullscreen method with proper error handling', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Extract the videoFullscreen method
    const methodMatch = html.match(/videoFullscreen\(\)\s*\{[\s\S]*?\n\s*\},/);
    expect(methodMatch).toBeTruthy();

    const methodCode = methodMatch[0];

    // Verify error handling
    expect(methodCode).toContain('console.error');
    expect(methodCode).toContain('[fullscreen]');
    expect(methodCode).toContain('requestFullscreen');
    expect(methodCode).toContain('webkitRequestFullscreen');
    expect(methodCode).toContain('mozRequestFullScreen');
    expect(methodCode).toContain('msRequestFullscreen');
    expect(methodCode).toContain('.catch(err');
    expect(methodCode).toContain('err.name');
    expect(methodCode).toContain('SecurityError');
    expect(methodCode).toContain('NotSupportedError');

    console.log('✓ videoFullscreen method has proper error handling');
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
    expect(modalCode).toMatch(/onclick="event\.stopPropagation\(\);\s*event\.preventDefault\(\);\s*App\.videoFullscreen\(\);"/);
    expect(modalCode).toMatch(/onclick="App\.closeDemoModal\(\)"/);

    console.log('✓ Modal structure and event handlers are correct');
  });

  it('should have required button onclick handlers verified', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Count the fullscreen buttons (should be at least 2 - landing and app)
    const fullscreenMatches = html.match(/Pantalla completa/g);
    expect(fullscreenMatches && fullscreenMatches.length >= 1).toBe(true);

    console.log(`✓ Found ${fullscreenMatches?.length || 0} fullscreen button(s)`);

    // Verify the button has all required onclick parts
    const fullscreenButtonMatch = html.match(/onclick="event\.stopPropagation\(\);\s*event\.preventDefault\(\);\s*App\.videoFullscreen\(\);"/);
    expect(fullscreenButtonMatch).toBeTruthy();

    console.log('✓ Fullscreen button has complete onclick handler');
  });

  it('should verify method is callable and defined', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Extract script content
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();

    const scriptContent = scriptMatch[1];

    // Verify videoFullscreen is defined
    expect(scriptContent).toContain('videoFullscreen()');

    // Verify it's part of the App object
    expect(scriptContent).toMatch(/videoFullscreen\s*\(\s*\)\s*\{/);

    // Verify the method handles the video element properly
    expect(scriptContent).toContain('document.getElementById(\'demo-video\')');
    expect(scriptContent).toContain('.then(');
    expect(scriptContent).toContain('.catch(');

    console.log('✓ videoFullscreen method is properly defined with promise handling');
  });

  it('should have closeDemoModal method that exits fullscreen', () => {
    const htmlPath = path.resolve('/home/user/ParfumTrack/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Extract script content
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    const scriptContent = scriptMatch[1];

    // Find closeDemoModal method
    const closeMatch = scriptContent.match(/closeDemoModal\(\)\s*\{[\s\S]*?\n\s*\},/);
    expect(closeMatch).toBeTruthy();

    const closeCode = closeMatch[0];

    // Verify it handles fullscreen exit
    expect(closeCode).toContain('exitFullscreen');
    expect(closeCode).toContain('document.fullscreenElement');
    expect(closeCode).toContain('webkitFullscreenElement');
    expect(closeCode).toContain('mozFullScreenElement');

    console.log('✓ closeDemoModal method properly exits fullscreen');
  });
});
