// Flow contract: every consumer installs a registry-only terminology runtime with no direct, aliased or transitive GDC package; root dependency overrides cannot hide a nested forbidden pin.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const pkg=JSON.parse(readFileSync(new URL('package.json',root),'utf8'));
const lock=JSON.parse(readFileSync(new URL('package-lock.json',root),'utf8'));
function declarations(value){return Object.entries({...value.dependencies,...value.optionalDependencies,...value.peerDependencies,...value.devDependencies})}

test('declares only registry dependencies and no direct or aliased GDC package',()=>{
  for(const [name,spec]of declarations(pkg)){
    assert.doesNotMatch(name,/^gdc-/u);
    assert.doesNotMatch(spec,/(?:^|npm:)gdc-|^(?:file:|workspace:|link:|git\+|https?:\/\/|github:)/u);
  }
});

test('the committed registry lock has no nested GDC package or alias',()=>{
  for(const [path,value]of Object.entries(lock.packages??{})){
    assert.doesNotMatch(path,/(?:^|\/)node_modules\/gdc-/u,path);
    if(value.name)assert.doesNotMatch(value.name,/^gdc-/u,path);
    for(const [name,spec]of declarations(value)){
      assert.doesNotMatch(name,/^gdc-/u,`${path}: ${name}`);
      assert.doesNotMatch(spec,/npm:gdc-|^(?:file:|workspace:|link:|git\+|github:)/u,`${path}: ${name}`);
    }
  }
});

test('source modules do not import or re-export a GDC runtime or contract',()=>{
  function visit(directory){
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      const path=resolve(directory,entry.name);
      if(entry.isDirectory())visit(path);
      else if(/\.[cm]?tsx?$/u.test(entry.name))assert.doesNotMatch(readFileSync(path,'utf8'),/(?:from\s*|import\s*\(|require\s*\()\s*['"]gdc-/u,path);
    }
  }
  visit(fileURLToPath(new URL('src/',root)));
});
