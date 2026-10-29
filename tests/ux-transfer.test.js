import test from 'node:test';
import assert from 'node:assert/strict';
import { importConfiguration } from '../src/ui/transfer.js';

test('import destination is explicit and independent of manager state', () => {
  const config=importConfiguration({scopeType:'host',targetUrl:'https://auth.example.test/callback',storeId:'0',mode:'merge'});
  assert.equal(config.scope.url,'https://auth.example.test/callback');assert.equal(config.scope.type,'host');
  assert.equal(config.options.targetUrl,config.scope.url);assert.equal(config.options.mode,'merge');
  assert.throws(()=>importConfiguration({scopeType:'host',targetUrl:'chrome://extensions',storeId:'0'}),/HTTP/);
  assert.throws(()=>importConfiguration({scopeType:'all',storeId:'',mode:'merge'}),/store/);
});

test('domain-group imports validate chosen domains and expose only three distinct strategies', () => {
  const config=importConfiguration({scopeType:'domains',domains:'app.example.test, auth.example.test',storeId:'0',mode:'skip'});
  assert.deepEqual(config.scope.domains,['app.example.test','auth.example.test']);
  assert.equal(config.options.mode,'skip');
  assert.throws(()=>importConfiguration({scopeType:'domains',domains:'https://example.test',storeId:'0'}),/domain names/);
  assert.throws(()=>importConfiguration({scopeType:'all',storeId:'0',mode:'overwrite'}),/strategy/);
  assert.throws(()=>importConfiguration({scopeType:'all',storeId:'0',remapDomain:true}),/HTTP/);
});
