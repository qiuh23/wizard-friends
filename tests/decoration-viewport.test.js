import test from 'node:test';
import assert from 'node:assert/strict';
import {decorationViewport} from '../src/rendering/decoration-viewport.mjs';
test('edge decorations respect asymmetric landscape notches and portrait top/bottom padding',()=>{
  for(const [width,height,padding]of [[844,390,{paddingLeft:'47px',paddingRight:'21px'}],[390,844,{paddingTop:'59px',paddingBottom:'34px'}]]){
    const safe=decorationViewport(width,height,padding);
    assert.ok(safe.x(.035)*width>=parseFloat(padding.paddingLeft||0));
    assert.ok(safe.x(.965)*width<=width-parseFloat(padding.paddingRight||0));
    assert.ok(safe.y(.21)*height>=parseFloat(padding.paddingTop||0));
    assert.ok(safe.y(.66)*height<=height-parseFloat(padding.paddingBottom||0));
  }
});
test('no safe-area padding preserves the established anchors and invalid insets stay bounded',()=>{
  const safe=decorationViewport(844,390);assert.equal(safe.x(.035),.035);assert.ok(Math.abs(safe.y(.66)-.66)<1e-10);
  const bounded=decorationViewport(320,568,{paddingLeft:'-8px',paddingRight:'9999px',paddingTop:'auto'});
  assert.ok(bounded.x(.965)>.7&&bounded.x(.965)<1);assert.equal(bounded.y(.21),.21);
});
