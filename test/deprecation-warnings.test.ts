// eslint-disable-next-line import/no-extraneous-dependencies
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

import { compile, Lock } from './fixtures';
import { compileJsiiForTest, HelperCompilationResult } from '../lib';

const DEPRECATED = '/** @deprecated Use something else */';

describe('Function generation', () => {
  test('generates the print function', () => {
    const result = compileJsiiForTest('', undefined /* callback */, {
      addDeprecationWarnings: true,
    });

    expect(jsFile(result, '.warnings.jsii')).toBe(
      `function print(name, deprecationMessage) {
    const deprecated = process.env.JSII_DEPRECATED;
    const deprecationMode = ["warn", "fail", "quiet"].includes(deprecated) ? deprecated : "warn";
    const message = \`\${name} is deprecated.\\n  \${deprecationMessage.trim()}\\n  This API will be removed in the next major release.\`;
    switch (deprecationMode) {
        case "fail":
            throw new DeprecationError(message);
        case "warn":
            console.warn("[WARNING]", message);
            break;
    }
}
function getPropertyDescriptor(obj, prop) {
    const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
    if (descriptor) {
        return descriptor;
    }
    const proto = Object.getPrototypeOf(obj);
    const prototypeDescriptor = proto && getPropertyDescriptor(proto, prop);
    if (prototypeDescriptor) {
        return prototypeDescriptor;
    }
    return {};
}
const visitedObjects = new Set();
class DeprecationError extends Error {
    constructor(...args) {
        super(...args);
        Object.defineProperty(this, "name", {
            configurable: false,
            enumerable: true,
            value: "DeprecationError",
            writable: false,
        });
    }
}
module.exports = { print, getPropertyDescriptor, DeprecationError };
`,
    );
  });

  test('generates a function for each type', () => {
    const result = compileJsiiForTest(
      `
        export interface Foo {}
        export interface Bar {}
        export interface Baz {}
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(
      `function testpkg_Foo(p) {
}
function testpkg_Bar(p) {
}
function testpkg_Baz(p) {
}`,
    );
  });

  test('generates metadata', () => {
    const result = compileJsiiForTest(
      `
        export interface Foo {}
        export interface Bar {}
        export interface Baz {}
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );
    expect(result.assembly.metadata?.jsii?.compiledWithDeprecationWarnings).toBe(true);
  });

  test('for each non-primitive property, generates a call', () => {
    const result = compileJsiiForTest(
      `
        export interface Foo {}
        export interface Bar {}
        export interface Baz {
          readonly foo: Foo;
          readonly bar: Bar;
          readonly x: string;
        }
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(`function testpkg_Baz(p) {
    if (p == null)
        return;
    visitedObjects.add(p);
    try {
        if (!visitedObjects.has(p.bar))
            testpkg_Bar(p.bar);
        if (!visitedObjects.has(p.foo))
            testpkg_Foo(p.foo);
    }
    finally {
        visitedObjects.delete(p);
    }
}`);
  });

  test('generates empty functions for interfaces', () => {
    const result = compileJsiiForTest(
      `
        export interface IFoo {
          bar(): string;
        }
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(`function testpkg_IFoo(p) {
}`);
  });

  test('generates empty functions for classes', () => {
    const result = compileJsiiForTest(
      `
        export class Foo {
          bar() {return 0};
        }
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(`function testpkg_Foo(p) {
}`);
  });

  test('generates calls for recursive types', () => {
    const result = compileJsiiForTest(
      `
        export interface Bar {readonly bar?: Bar}
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(
      `function testpkg_Bar(p) {
    if (p == null)
        return;
    visitedObjects.add(p);
    try {
        if (!visitedObjects.has(p.bar))
            testpkg_Bar(p.bar);
    }
    finally {
        visitedObjects.delete(p);
    }
}`,
    );
  });

  test('checks array elements', () => {
    const result = compileJsiiForTest(
      `
      export interface Used { readonly property: boolean; }
      export interface Uses { readonly array: Used[]; }
      `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFunction(result, 'testpkg_Uses', '.warnings.jsii')).toMatchInlineSnapshot(`
      "function testpkg_Uses(p) {
          if (p == null)
              return;
          visitedObjects.add(p);
          try {
              if (p.array != null)
                  for (const o of p.array)
                      if (!visitedObjects.has(o))
                          testpkg_Used(o);
          }
          finally {
              visitedObjects.delete(p);
          }
      }"
    `);
  });

  test('checks map elements', () => {
    const result = compileJsiiForTest(
      `
      export interface Used { readonly property: boolean; }
      export interface Uses { readonly map: Record<string, Used>; }
      `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFunction(result, 'testpkg_Uses', '.warnings.jsii')).toMatchInlineSnapshot(`
      "function testpkg_Uses(p) {
          if (p == null)
              return;
          visitedObjects.add(p);
          try {
              if (p.map != null)
                  for (const o of Object.values(p.map))
                      if (!visitedObjects.has(o))
                          testpkg_Used(o);
          }
          finally {
              visitedObjects.delete(p);
          }
      }"
    `);
  });

  test('generates exports for all the functions', () => {
    const result = compileJsiiForTest(
      `
        export interface Foo {}
        export interface Bar {}
        export interface Baz {}
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(
      'module.exports = { print, getPropertyDescriptor, DeprecationError, testpkg_Foo, testpkg_Bar, testpkg_Baz };',
    );
  });

  test('generates functions for enums', () => {
    const result = compileJsiiForTest(
      `
        export enum State {
          ON,

          ${DEPRECATED}
          OFF
        }
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(`function testpkg_State(p) {
    if (p == null)
        return;
    visitedObjects.add(p);
    try {
        const ns = require("./index.js");
        if (Object.values(ns.State).filter(x => x === p).length > 1)
            return;
        if (p === ns.State.OFF)
            print("testpkg.State#OFF", "Use something else");
    }
    finally {
        visitedObjects.delete(p);
    }
}
`);
  });

  test('generates calls for deprecated inherited properties', () => {
    const result = compileJsiiForTest(
      `
        export interface Baz {
          /** @deprecated message from Baz */
          readonly x: string;
        }
        export interface Bar {
          /** @deprecated message from Bar */
          readonly x: string;
        }
        export interface Foo extends Bar, Baz {
        }
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    const warningsFileContent = jsFile(result, '.warnings.jsii');

    // For each supertype, its corresponding function should be generated, as usual
    expect(warningsFileContent).toMatch(`function testpkg_Baz(p) {
    if (p == null)
        return;
    visitedObjects.add(p);
    try {
        if ("x" in p)
            print("testpkg.Baz#x", "message from Baz");
    }
    finally {
        visitedObjects.delete(p);
    }
}`);
    expect(warningsFileContent).toMatch(`function testpkg_Bar(p) {
    if (p == null)
        return;
    visitedObjects.add(p);
    try {
        if ("x" in p)
            print("testpkg.Bar#x", "message from Bar");
    }
    finally {
        visitedObjects.delete(p);
    }
}`);

    // But a call for one of the instances of the property should also be generated in the base function
    expect(warningsFileContent).toMatch(`function testpkg_Foo(p) {
    if (p == null)
        return;
    visitedObjects.add(p);
    try {
        if ("x" in p)
            print("testpkg.Baz#x", "message from Baz");
    }
    finally {
        visitedObjects.delete(p);
    }
}`);
  });

  test('skips properties that are deprecated in one supertype but not the other', () => {
    const result = compileJsiiForTest(
      `
        export interface Baz {
          readonly x: string;
        }
        export interface Bar {
          /** @deprecated message from Bar */
          readonly x: string;
        }
        export interface Foo extends Bar, Baz {
        }
        `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    const warningsFileContent = jsFile(result, '.warnings.jsii');

    expect(warningsFileContent).toMatch(`function testpkg_Foo(p) {
}`);
  });

  test('generates calls for types with deprecated properties', () => {
    const result = compileJsiiForTest(
      `
      export interface Bar {
        readonly x: string;
      }

      export interface Foo {
        readonly y: string;

        /** @deprecated kkkkkkkk */
        readonly bar: Bar;
      }
      `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(`function testpkg_Foo(p) {
    if (p == null)
        return;
    visitedObjects.add(p);
    try {
        if ("bar" in p)
            print("testpkg.Foo#bar", "kkkkkkkk");
        if (!visitedObjects.has(p.bar))
            testpkg_Bar(p.bar);
    }
    finally {
        visitedObjects.delete(p);
    }
}
`);
  });

  test('generates calls for each property of a deprecated type', () => {
    const result = compileJsiiForTest(
      `
      /** @deprecated use Bar instead */
      export interface Foo {
        readonly bar: string;
        readonly baz: number;
      }
      `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result, '.warnings.jsii')).toMatch(`function testpkg_Foo(p) {
    if (p == null)
        return;
    visitedObjects.add(p);
    try {
        if ("bar" in p)
            print("testpkg.Foo#bar", "use Bar instead");
        if ("baz" in p)
            print("testpkg.Foo#baz", "use Bar instead");
    }
    finally {
        visitedObjects.delete(p);
    }
}
`);
  });

  describe('using fixtures', () => {
    let lock: Lock | undefined;

    beforeEach(async () => {
      lock = await Lock.acquire();
    }, 120_000);

    afterEach(async () => {
      await lock?.release();
      lock = undefined;
    }, 120_000);

    test('generates calls for types in other assemblies', async () => {
      compile(lock!, '@scope/jsii-calc-base-of-base', false);
      const calcBaseRoot = compile(lock!, '@scope/jsii-calc-base', true);
      compile(lock!, '@scope/jsii-calc-lib', true, 'deprecated-to-strip.txt');
      const warningsFile = loadWarningsFile(calcBaseRoot);

      // jsii-calc-base was compiled with warnings. So we expect to see handlers for its types in the warnings file
      expect(warningsFile).toMatch('_scope_jsii_calc_base');

      // jsii-calc-base-of-base was not compiled with warnings. Its types shouldn't be in the warnings file
      expect(warningsFile).not.toMatch('_scope_jsii_calc_base_of_base');

      // Recompiling without deprecation warning to leave the packages in a clean state
      compile(lock!, '@scope/jsii-calc-base', false);
      compile(lock!, '@scope/jsii-calc-lib', false, 'deprecated-to-strip.txt');
    }, 120_000);
  });
});

describe('Call injections', () => {
  test('does not add warnings by default', () => {
    const result = compileJsiiForTest(
      `
    export class Foo {
      ${DEPRECATED}
      public bar(){}
    }
  `,
    );

    expect(jsFile(result)).toMatch('bar() { }');
    expect(result.assembly.metadata?.jsii?.compiledWithDeprecationWarnings).toBeFalsy();
  });

  test('generates a require statement', () => {
    const result = compileJsiiForTest(
      {
        'index.ts': "export * from './some/folder/source'",
        'some/folder/source.ts': `
          export class Foo {
            ${DEPRECATED}
            public bar(){}
          }
        `,
      },
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    const expectedPath = ['..', '..', '.warnings.jsii.js'].join('/');

    const content = jsFile(result, 'some/folder/source');
    expect(content).toContain(`const jsiiDeprecationWarnings = require("${expectedPath}")`);
  }, 60000);

  test('does not generate a require statement when no calls were injected', () => {
    const result = compileJsiiForTest(
      {
        'index.ts': "export * from './some/folder/handler'",
        'some/folder/handler.ts': `
          export function handler(event: any) { return event; }
        `,
      },
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    const expectedPath = ['..', '..', '.warnings.jsii.js'].join('/');

    const content = jsFile(result, 'some/folder/handler');
    expect(content).not.toContain(`const jsiiDeprecationWarnings = require("${expectedPath}")`);
  }, 60000);

  test('deprecated methods', () => {
    const result = compileJsiiForTest(
      `
    export class Foo {
      ${DEPRECATED}
      public bar(){}
    }
  `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result)).toMatchInlineSnapshot(`
      ""use strict";
      var _a;
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.Foo = void 0;
      const jsiiDeprecationWarnings = require("./.warnings.jsii.js");
      const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
      class Foo {
          /** @deprecated Use something else */
          bar() { try {
              jsiiDeprecationWarnings.print("testpkg.Foo#bar", "Use something else");
          }
          catch (error) {
              if (process.env.JSII_DEBUG !== "1" && error.name === "DeprecationError") {
                  Error.captureStackTrace(error, this.bar);
              }
              throw error;
          } }
      }
      _a = JSII_RTTI_SYMBOL_1;
      Foo[_a] = { fqn: "testpkg.Foo", version: "0.0.1" };
      exports.Foo = Foo;
      //# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDSSxNQUFhLEdBQUc7SUFDZCxxQ0FBcUM7SUFDOUIsR0FBRzs7Ozs7Ozs7T0FBSTs7OztBQUZILGtCQUFHIiwic291cmNlc0NvbnRlbnQiOlsiXG4gICAgZXhwb3J0IGNsYXNzIEZvbyB7XG4gICAgICAvKiogQGRlcHJlY2F0ZWQgVXNlIHNvbWV0aGluZyBlbHNlICovXG4gICAgICBwdWJsaWMgYmFyKCl7fVxuICAgIH1cbiAgIl19"
    `);
  });

  test('methods with parameters', () => {
    const result = compileJsiiForTest(
      `
        export interface A {readonly x: number;}
         export class Foo {
          public bar(a: A, b: number){return a.x + b;}
         }`,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result)).toMatchInlineSnapshot(`
      ""use strict";
      var _a;
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.Foo = void 0;
      const jsiiDeprecationWarnings = require("./.warnings.jsii.js");
      const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
      class Foo {
          bar(a, b) { try {
              jsiiDeprecationWarnings.testpkg_A(a);
          }
          catch (error) {
              if (process.env.JSII_DEBUG !== "1" && error.name === "DeprecationError") {
                  Error.captureStackTrace(error, this.bar);
              }
              throw error;
          } return a.x + b; }
      }
      _a = JSII_RTTI_SYMBOL_1;
      Foo[_a] = { fqn: "testpkg.Foo", version: "0.0.1" };
      exports.Foo = Foo;
      //# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFFUyxNQUFhLEdBQUc7SUFDUixHQUFHLENBQUMsQ0FBSSxFQUFFLENBQVM7Ozs7Ozs7O01BQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFDOzs7O0FBRGhDLGtCQUFHIiwic291cmNlc0NvbnRlbnQiOlsiXG4gICAgICAgIGV4cG9ydCBpbnRlcmZhY2UgQSB7cmVhZG9ubHkgeDogbnVtYmVyO31cbiAgICAgICAgIGV4cG9ydCBjbGFzcyBGb28ge1xuICAgICAgICAgIHB1YmxpYyBiYXIoYTogQSwgYjogbnVtYmVyKXtyZXR1cm4gYS54ICsgYjt9XG4gICAgICAgICB9Il19"
    `);
  }, 60000);

  test('deprecated getters', () => {
    const result = compileJsiiForTest(
      `
    export class Foo {
      private _x = 0;
      ${DEPRECATED}
      public get x(){return this._x}
    }
  `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result)).toMatchInlineSnapshot(`
      ""use strict";
      var _a;
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.Foo = void 0;
      const jsiiDeprecationWarnings = require("./.warnings.jsii.js");
      const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
      class Foo {
          constructor() {
              this._x = 0;
          }
          /** @deprecated Use something else */
          get x() { try {
              jsiiDeprecationWarnings.print("testpkg.Foo#x", "Use something else");
          }
          catch (error) {
              if (process.env.JSII_DEBUG !== "1" && error.name === "DeprecationError") {
                  Error.captureStackTrace(error, jsiiDeprecationWarnings.getPropertyDescriptor(this, "x").get);
              }
              throw error;
          } return this._x; }
      }
      _a = JSII_RTTI_SYMBOL_1;
      Foo[_a] = { fqn: "testpkg.Foo", version: "0.0.1" };
      exports.Foo = Foo;
      //# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDSSxNQUFhLEdBQUc7SUFBaEI7UUFDVSxPQUFFLEdBQUcsQ0FBQyxDQUFDO0tBR2hCO0lBRkMscUNBQXFDO0lBQ3JDLElBQVcsQ0FBQzs7Ozs7Ozs7TUFBRyxPQUFPLElBQUksQ0FBQyxFQUFFLENBQUEsRUFBQzs7OztBQUhuQixrQkFBRyIsInNvdXJjZXNDb250ZW50IjpbIlxuICAgIGV4cG9ydCBjbGFzcyBGb28ge1xuICAgICAgcHJpdmF0ZSBfeCA9IDA7XG4gICAgICAvKiogQGRlcHJlY2F0ZWQgVXNlIHNvbWV0aGluZyBlbHNlICovXG4gICAgICBwdWJsaWMgZ2V0IHgoKXtyZXR1cm4gdGhpcy5feH1cbiAgICB9XG4gICJdfQ=="
    `);
  });

  test('deprecated setters', () => {
    const result = compileJsiiForTest(
      `
    export class Foo {
      private _x = 0;
      public get x(){return this._x}

      ${DEPRECATED}
      public set x(_x: number) {this._x = _x;}
    }
  `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result)).toMatchInlineSnapshot(`
      ""use strict";
      var _a;
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.Foo = void 0;
      const jsiiDeprecationWarnings = require("./.warnings.jsii.js");
      const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
      class Foo {
          constructor() {
              this._x = 0;
          }
          get x() { try {
              jsiiDeprecationWarnings.print("testpkg.Foo#x", "Use something else");
          }
          catch (error) {
              if (process.env.JSII_DEBUG !== "1" && error.name === "DeprecationError") {
                  Error.captureStackTrace(error, jsiiDeprecationWarnings.getPropertyDescriptor(this, "x").get);
              }
              throw error;
          } return this._x; }
          /** @deprecated Use something else */
          set x(_x) { try {
              jsiiDeprecationWarnings.print("testpkg.Foo#x", "Use something else");
          }
          catch (error) {
              if (process.env.JSII_DEBUG !== "1" && error.name === "DeprecationError") {
                  Error.captureStackTrace(error, jsiiDeprecationWarnings.getPropertyDescriptor(this, "x").set);
              }
              throw error;
          } this._x = _x; }
      }
      _a = JSII_RTTI_SYMBOL_1;
      Foo[_a] = { fqn: "testpkg.Foo", version: "0.0.1" };
      exports.Foo = Foo;
      //# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDSSxNQUFhLEdBQUc7SUFBaEI7UUFDVSxPQUFFLEdBQUcsQ0FBQyxDQUFDO0tBS2hCO0lBSkMsSUFBVyxDQUFDOzs7Ozs7OztNQUFHLE9BQU8sSUFBSSxDQUFDLEVBQUUsQ0FBQSxFQUFDO0lBRTlCLHFDQUFxQztJQUNyQyxJQUFXLENBQUMsQ0FBQyxFQUFVOzs7Ozs7OztNQUFHLElBQUksQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUM7Ozs7QUFMN0Isa0JBQUciLCJzb3VyY2VzQ29udGVudCI6WyJcbiAgICBleHBvcnQgY2xhc3MgRm9vIHtcbiAgICAgIHByaXZhdGUgX3ggPSAwO1xuICAgICAgcHVibGljIGdldCB4KCl7cmV0dXJuIHRoaXMuX3h9XG5cbiAgICAgIC8qKiBAZGVwcmVjYXRlZCBVc2Ugc29tZXRoaW5nIGVsc2UgKi9cbiAgICAgIHB1YmxpYyBzZXQgeChfeDogbnVtYmVyKSB7dGhpcy5feCA9IF94O31cbiAgICB9XG4gICJdfQ=="
    `);
  });

  test('creates a new instance of error when test', () => {
    const result = compileJsiiForTest(
      `
    ${DEPRECATED}
    export class Foo {
      constructor(){}
    }
  `,
      undefined /* callback */,
      { addDeprecationWarnings: true },
    );

    expect(jsFile(result)).toMatchInlineSnapshot(`
      ""use strict";
      var _a;
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.Foo = void 0;
      const jsiiDeprecationWarnings = require("./.warnings.jsii.js");
      const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
      /** @deprecated Use something else */
      class Foo {
          constructor() { try {
              jsiiDeprecationWarnings.print("testpkg.Foo", "Use something else");
          }
          catch (error) {
              if (process.env.JSII_DEBUG !== "1" && error.name === "DeprecationError") {
                  Error.captureStackTrace(error, Foo);
              }
              throw error;
          } }
      }
      _a = JSII_RTTI_SYMBOL_1;
      Foo[_a] = { fqn: "testpkg.Foo", version: "0.0.1" };
      exports.Foo = Foo;
      //# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDSSxxQ0FBcUM7QUFDckMsTUFBYSxHQUFHO0lBQ2Q7Ozs7OzJDQURXLEdBQUc7OztPQUNDOzs7O0FBREosa0JBQUciLCJzb3VyY2VzQ29udGVudCI6WyJcbiAgICAvKiogQGRlcHJlY2F0ZWQgVXNlIHNvbWV0aGluZyBlbHNlICovXG4gICAgZXhwb3J0IGNsYXNzIEZvbyB7XG4gICAgICBjb25zdHJ1Y3Rvcigpe31cbiAgICB9XG4gICJdfQ=="
    `);
  });
});

describe('thrown exceptions have the expected stack trace', () => {
  test('constructor', () => {
    const compilation = compileJsiiForTest(
      `
      /** @deprecated for testing */
      export class DeprecatedConstructor {
        public constructor() {}
      }

      function test() {
        new DeprecatedConstructor();
      }

      test();
    `,
      undefined,
      { addDeprecationWarnings: true },
    );
    const source = jsFile(compilation);

    const context = createVmContext(compilation);
    try {
      vm.runInContext(source, context, { filename: 'index.js' });
      // The above line should have resulted in a DeprecationError being thrown
      expect(null).toBeInstanceOf(Error);
    } catch (error: any) {
      expect(error.stack.replace(process.cwd(), '<process.cwd>')).toMatchInlineSnapshot(`
        "index.js:16
                throw error;
                ^

        DeprecationError: testpkg.DeprecatedConstructor is deprecated.
         for testing
         This API will be removed in the next major release.
            at test (index.js:23:5)
            at index.js:25:1"
      `);
    }
  });

  test('getter', () => {
    const compilation = compileJsiiForTest(
      `
      export class DeprecatedConstructor {
        /** @deprecated for testing */
        public get property() {
          return 1337;
        }
      }

      function test() {
        const subject = new DeprecatedConstructor();
        return subject.property;
      }

      test();
    `,
      undefined,
      { addDeprecationWarnings: true },
    );
    const source = jsFile(compilation);

    const context = createVmContext(compilation);
    try {
      vm.runInContext(source, context, { filename: 'index.js' });
      // The above line should have resulted in a DeprecationError being thrown
      expect(null).toBeInstanceOf(Error);
    } catch (error: any) {
      expect(error.stack.replace(process.cwd(), '<process.cwd>')).toMatchInlineSnapshot(`
        "index.js:17
                    throw error;
                    ^

        DeprecationError: testpkg.DeprecatedConstructor#property is deprecated.
         for testing
         This API will be removed in the next major release.
            at test (index.js:27:20)
            at index.js:29:1"
      `);
    }
  });

  test('setter', () => {
    const compilation = compileJsiiForTest(
      `
      export class DeprecatedConstructor {
        private value = 1337;

        /** @deprecated for testing */
        public get property(): number {
          return this.value;
        }

        public set property(value: number) {
          this.value = value;
        }
      }

      function test() {
        const subject = new DeprecatedConstructor();
        subject.property = 42;
      }

      test();
    `,
      undefined,
      { addDeprecationWarnings: true },
    );
    const source = jsFile(compilation);

    const context = createVmContext(compilation);
    try {
      vm.runInContext(source, context, { filename: 'index.js' });
      // The above line should have resulted in a DeprecationError being thrown
      expect(null).toBeInstanceOf(Error);
    } catch (error: any) {
      expect(error.stack.replace(process.cwd(), '<process.cwd>')).toMatchInlineSnapshot(`
        "index.js:32
                    throw error;
                    ^

        DeprecationError: testpkg.DeprecatedConstructor#property is deprecated.
         for testing
         This API will be removed in the next major release.
            at test (index.js:42:22)
            at index.js:44:1"
      `);
    }
  });

  test('method', () => {
    const compilation = compileJsiiForTest(
      `
      export class DeprecatedConstructor {
        /** @deprecated for testing */
        public deprecated(): void {
          // Nothing to do
        }
      }

      function test() {
        const subject = new DeprecatedConstructor();
        subject.deprecated();
      }

      test();
    `,
      undefined,
      { addDeprecationWarnings: true },
    );
    const source = jsFile(compilation);

    const context = createVmContext(compilation);
    try {
      vm.runInContext(source, context, { filename: 'index.js' });
      // The above line should have resulted in a DeprecationError being thrown
      expect(null).toBeInstanceOf(Error);
    } catch (error: any) {
      expect(error.stack.replace(process.cwd(), '<process.cwd>')).toMatchInlineSnapshot(`
        "index.js:17
                    throw error;
                    ^

        DeprecationError: testpkg.DeprecatedConstructor#deprecated is deprecated.
         for testing
         This API will be removed in the next major release.
            at test (index.js:26:13)
            at index.js:28:1"
      `);
    }
  });
});

function jsFile(result: HelperCompilationResult, baseName = 'index'): string {
  const file = Object.entries(result.files).find(([name]) => name === `${baseName}.js`);

  if (!file) {
    throw new Error(`Could not find file with base name: ${baseName}`);
  }

  return file[1];
}

function jsFunction(result: HelperCompilationResult, functionName: string, baseName = 'index'): string {
  const lines = jsFile(result, baseName).split(/\n/);

  const startIndex = lines.indexOf(`function ${functionName}(p) {`);
  if (startIndex < 0) {
    throw new Error(`Could not find declaration of ${functionName} in file with base name: ${baseName}`);
  }
  const endIndex = lines.indexOf('}', startIndex);

  return lines.slice(startIndex, endIndex + 1).join('\n');
}

function createVmContext(compilation: HelperCompilationResult) {
  const context = vm.createContext({
    exports: {},
    process: {
      env: {
        JSII_DEPRECATED: 'fail',
      },
    },
    // Bringing in a "fake" require(id) function that'll resolve relative paths
    // to files within the compilation output, and module names using the
    // regular require. When loading a file that was part of the compiler output,
    // this emulates the situation that would be if the file had been through a
    // bundler by turning all sequences of white spaces (new line included) into
    // single spaces.
    require: (id: string) => {
      if (!id.startsWith('./')) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(id);
      }
      const code = jsFile(compilation, path.basename(id, '.js'))
        // Pretend this has been webpack'd
        .replace(/\s+/gm, ' ');
      return vm.runInContext(
        `(function(module){
          {
            ${code}
          }
          return module.exports;
        })({ exports: {} });`,
        context,
        { filename: id, lineOffset: -2, columnOffset: -4 },
      );
    },
  });

  // Limit error stack traces to 2 frames... We don't need more for the sake of this test. This is
  // important because past 2 levels, the stack frames will have entries that will be different on
  // different versions of node, and that'll break our unit tests...
  vm.runInContext('Error.stackTraceLimit = 2;', context);

  return context;
}

function loadWarningsFile(projectRoot: string) {
  return fs.readFileSync(path.join(projectRoot, '.warnings.jsii.js')).toString();
}
