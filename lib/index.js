"use strict";

const Module = require("module");
const require_ = Module.prototype.require;
const InstantiateReactComponent = require("react/lib/instantiateReactComponent");
const EscapeTextContentForBrowser = require("react/lib/escapeTextContentForBrowser");

const get = require("lodash/get");
const set = require("lodash/set");
const wrap = require("lodash/wrap");
const template = require("lodash/template");
const isObject = require("lodash/isObject");
const cache = require("lru-cache");

const MILLISECONDS_IN_ONE_SECOND = 1000;
const SECONDS_IN_ONE_MINUTE = 60;
const DEFAULT_MINUTES_TO_CACHE = 60;

const DEFAULT_LRU_CONFIG = {
  max: 500,  //The maximum size of the cache
  maxAge: DEFAULT_MINUTES_TO_CACHE * SECONDS_IN_ONE_MINUTE * MILLISECONDS_IN_ONE_SECOND
};

const EMPTY_ID = -1;

const defaultCacheKeyFunction = () => {
  return "_defaultKey";
};

const genAttrBasedKeyFunction = (attrs) => {
  return ((props) => {
    let key = "";
    attrs.forEach((attr) => {
      const val = get(props, attr);
      key += isObject(val) ? JSON.stringify(val) : val;
    });
    return key;
  });
};

class InstantiateReactComponentOptimizer {

  constructor(config) {
    if (process.env.NODE_ENV !== "production") {
      console.info(  // eslint-disable-line no-console
        "Caching is disabled in non-production environments."
      );
    } else {
      this.config = config;
      this.componentsToCache = config.components ? Object.keys(config.components) : [];
      this.componentsToCache.forEach((cmpName) => {
        let cacheConfig = config.components[cmpName];
        if (cacheConfig instanceof Function) {
          cacheConfig = config.components[cmpName] = {
            cacheKeyGen: cacheConfig
          };
        }
        if (isObject(cacheConfig) && !cacheConfig.cacheKeyGen) {
          cacheConfig.cacheKeyGen = cacheConfig.cacheAttrs && cacheConfig.cacheAttrs.length
            ? genAttrBasedKeyFunction(cacheConfig.cacheAttrs)
            : defaultCacheKeyFunction;
        }
      }, this);
      /* eslint-disable no-nested-ternary */
      this.lruCache = (config.cacheImpl) ? config.cacheImpl :
        (config.lruCacheSettings) ? cache(config.lruCacheSettings) : cache(DEFAULT_LRU_CONFIG);
      this.enabled = !(config.disabled === true);
      this.eventCallback = config.eventCallback;
      this.shouldCollectLoadTimeStats = config.collectLoadTimeStats;
      this.wrapInstantiateReactComponent();
    }
  }

  wrapInstantiateReactComponent() {
    const self = this;

    function eventCallback(event) {
      if (self.eventCallback) {
        process.nextTick(() => {
          self.eventCallback(event);
        });
      }
    }

    /* eslint-disable max-params, no-console*/
    const restorePropsAndProcessTemplate = (compiled, templateAttrs, templateAttrValues, curEl) => {
      templateAttrs.forEach((attrKey) => {
        const _attrKey = attrKey.replace(".", "__");
        set(curEl.props, attrKey, templateAttrValues[_attrKey]);
        templateAttrValues[_attrKey] = EscapeTextContentForBrowser(templateAttrValues[_attrKey]);
      });
      return compiled(templateAttrValues);
    };
    /* eslint-enable max-params, no-console*/

    const shouldComponentBeCached = function (curEl) {
      return curEl && curEl.type &&
        (self.componentsToCache.indexOf(curEl.type.displayName) > EMPTY_ID ||
        self.componentsToCache.indexOf(curEl.type.name) > EMPTY_ID);
    };

    /* eslint-disable max-params */
    const templatizeProps = function (attrKey, templateAttrValues, curEl, cmpName) {
      const _attrKey = attrKey.replace(".", "__");
      templateAttrValues[_attrKey] = get(curEl.props, attrKey);
      if (isObject(templateAttrValues[_attrKey])) {
        throw new Error(
          `Cannot templatize Object at ${attrKey} for component ${cmpName}`
        );
      }
      /* eslint-disable prefer-template */
      set(curEl.props, attrKey, "${" + _attrKey + "}");
    };

    const WrappedInstantiateReactComponent = wrap(InstantiateReactComponent,
      function (instantiate) {
        const component = instantiate.apply(
          instantiate, [].slice.call(arguments, 1));
        if (component._instantiateReactComponent
          && (!component._instantiateReactComponent.__wrapped)) {
          component._instantiateReactComponent = WrappedInstantiateReactComponent;
        }
        if (self.enabled) {
          const curEl = component._currentElement;
          if (shouldComponentBeCached(curEl)) {
            /* eslint-disable max-statements */
            component.mountComponent = wrap(
              component.mountComponent,
              function (mount) {
                const cmpName = (curEl.type.displayName || curEl.type.name);
                const generatedKey = self.config.components[cmpName].cacheKeyGen(curEl.props);
                if (generatedKey === null) {
                  return mount.apply(component, [].slice.call(arguments, 1));
                }
                const cacheKey = `${cmpName}:${generatedKey}`;
                const rootID = arguments[1];
                const templateAttrs = self.config.components[cmpName].templateAttrs || [];
                const templateAttrValues = {};
                templateAttrs.forEach((attrKey) => {
                  templatizeProps(attrKey, templateAttrValues, curEl, cmpName);
                });
                const cachedObj = self.lruCache.get(cacheKey);
                if (cachedObj) {
                  eventCallback({type: "cache", event: "hit", cmpName: cmpName});
                  const cacheMarkup = templateAttrs.length ?
                    restorePropsAndProcessTemplate(cachedObj.compiled, templateAttrs,
                      templateAttrValues, curEl)
                    : cachedObj.markup;
                  /* eslint-disable quotes */
                  return cacheMarkup.replace(
                    new RegExp(`data-reactid="${cachedObj.rootId}`, "g"),
                    `data-reactid="${rootID}`);
                }

                const markUpGenerateStartTime = self.shouldCollectLoadTimeStats ?
                  process.hrtime() : 0;
                const markup = mount.apply(component, [].slice.call(arguments, 1));
                const compiledMarkup = templateAttrs.length ? template(markup) : null;
                const markUpGenerateEndTime = self.shouldCollectLoadTimeStats ?
                  process.hrtime(markUpGenerateStartTime) : 0;
                eventCallback({type: "cache", event: "miss", cmpName: cmpName,
                  loadTimeNS: (markUpGenerateEndTime[1])});
                self.lruCache.set(cacheKey, {
                  markup: markup, compiled: compiledMarkup, rootId: rootID
                });
                return templateAttrs.length ? restorePropsAndProcessTemplate(
                  compiledMarkup, templateAttrs, templateAttrValues, curEl)
                  : markup;
              });

            /* eslint-enable max-statements */
          }
        }
        return component;
      }
    );

    WrappedInstantiateReactComponent.__wrapped = true;

    Module.prototype.require = function (path) {
      const m = require_.apply(this, arguments);

      if (path === "./instantiateReactComponent") {
        return WrappedInstantiateReactComponent;
      }

      return m;
    };
  }

  enable(enableFlag) {
    this.enabled = enableFlag;
  }

  cacheDump() {
    return this.lruCache.dump();
  }

  cacheLength() {
    return this.lruCache.length;
  }

  cacheReset() {
    return this.lruCache.reset();
  }
}

module.exports = (config) => new InstantiateReactComponentOptimizer(config);
