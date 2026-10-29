import test from 'node:test';
import assert from 'node:assert/strict';
import { cookieId } from '../src/core/cookies.js';
import { dataForSource, selectionSummary, targetBinding, groupedCookies, localDateInput } from '../src/ui/model.js';
const scope = {type:'host',url:'https://example.com',storeId:'0',incognito:false};
const cookies = ['a','b','c'].map(name=>({name,value:'secret',domain:'example.com',path:'/',storeId:'0',hostOnly:true,secure:true,sameSite:'lax',session:true,incognito:false}));
test('profile/export sources distinguish complete scope, filters, and hidden selection',()=>{
 const selected=new Set([cookieId(cookies[0]),cookieId(cookies[1])]);
 const options={scope,filters:{query:'*c'},selected};
 assert.equal(dataForSource(cookies,{...options,source:'scope'}).length,3);
 assert.equal(dataForSource(cookies,{...options,source:'filtered'}).length,1);
 assert.equal(dataForSource(cookies,{...options,source:'selected'}).length,2);
 assert.deepEqual(selectionSummary(cookies,[cookies[2]],selected),{total:2,hidden:2,matching:0});
});
test('source selection cannot cross cookie scopes or stores',()=>{
 const foreign={...cookies[0],storeId:'1',incognito:true};
 assert.equal(dataForSource([...cookies,foreign],{scope,selected:new Set([cookieId(foreign)]),source:'selected'}).length,0);
});
test('reload binding refuses an old tab after pinning a different target',()=>{
 const tab={id:1,url:'https://example.com/old',title:'Example',incognito:false};
 assert.equal(targetBinding(tab,'https://example.com/new').valid,true);
 assert.equal(targetBinding(tab,'https://other.test').valid,false);
 assert.equal(targetBinding(tab,'https://example.com',true).valid,false);
 assert.equal(targetBinding(undefined,'https://example.com').valid,false);
});
test('grouping keeps each domain in one group while retaining sorted items within it',()=>{
 const mixed=[cookies[0],{...cookies[1],domain:'other.test'},cookies[2]];
 const groups=groupedCookies(mixed,true);
 assert.equal(groups.length,2);assert.deepEqual(groups[0].cookies.map(c=>c.name),['a','c']);
 assert.equal(groupedCookies(mixed,false).length,1);
});

test('local datetime filters roundtrip local wall time across rerenders',()=>{
 for(const month of [0,6,9]){const local=new Date(2026,month,29,14,35,0,0).getTime();assert.equal(Date.parse(localDateInput(local)),local);}
 assert.equal(localDateInput(NaN),'');
});
