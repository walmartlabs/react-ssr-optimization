<h1><img width="85" align="left" src="/images/react-ssr-logo.png">React Server-Side Rendering Optimization Library</h1>

This React Server-side optimization library is a configurable ReactJS extension for memoizing react component markup on the server. It also supports component templatization to further caching of rendered markup with more dynamic data.  This server-side module intercepts React's instantiateReactComponent module by using a `require()` hook and avoids forking React. 

[![Build Status](https://travis-ci.org/walmartlabs/react-ssr-optimization.svg?branch=master)](https://travis-ci.org/walmartlabs/react-ssr-optimization)
[![version](https://img.shields.io/npm/v/react-ssr-optimization.svg)](https://www.npmjs.org/package/react-ssr-optimization)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/walmartlabs/react-ssr-optimization/blob/master/LICENSE)

## Why we built it
React is a best-of-breed UI component framework allowing us to build higher level components that can be shared and reused across pages and apps. React's Virtual DOM offers an excellent development experience, freeing us up from having to manage subtle DOM changes. Most importantly, React offers us a great out-of-the-box isomorphic/universal JavaScript solution. React's `renderToString(..)` can fully render the HTML markup of a page to a string on the server. This is especially important for initial page load performance (particularly for mobile users with low bandwidth) and search engine indexing and ranking — both for SEO (search engine optimization) and SEM (search engine marketing).

However, it turns out that React’s server-side rendering can become a performance bottleneck for pages requiring many virtual DOM nodes. On large pages, `ReactDOMServer.renderToString(..)` can monopolize the CPU, block node’s event-loop and starve out incoming requests to the server. That’s because for every page request, the entire page needs to be rendered, even fine-grained components — which given the same props, always return the same markup. CPU time is wasted in unnecessarily re-rendering the same components for every page request.  Similar to pure functions in functional programing a pure component will always return the same HTML markup given the same props. Which means it should be possible to memoize (or cache) the rendered results to speed up rendering significantly after the first response. 

We also wanted the ability to memoize any pure component, not just those that implement a certain interface. So we created a configurable component caching library that accepts a map of component name to a cacheKey generator function. Application owners can opt into this optimization by specifying the component's name and referencing a cacheKey generator function. The cacheKey generator function returns a string representing all inputs into the component's rendering that is then used to cache the rendered markup. Subsequent renderings of the component with the same name and the same props will hit the cache and return the cached result.  This  optimization lowers CPU time for each page request and allows more concurrent requests that are not blocked on synchronous `renderToString` calls. The CPU profiles we took after before and after applying these optimizations show significant reduction no CPU utilization for each request.

<img width="800" align="center" src="/images/react-renderToString-cpu-profile.png">

### YouTube: Hastening React SSR with Component Memoization and Templatization
To learn more about why we built this library, check out a talk from the Full Stack meetup from July 2016:

<p><a href="http://www.youtube.com/watch?feature=player_embedded&v=sn-C_DKLKPE"><img src="http://img.youtube.com/vi/sn-C_DKLKPE/0.jpg" alt="YouTube: Hastening React SSR with Component Memoization and Templatization " width="240" height="180" border="10"></a></p>

As well as another (lower quality) recording from the San Diego Web Performance meetup from August 2016:

<p><a href="https://youtu.be/yu0MsXPyPI4?t=13m55s"><img src="https://a248.e.akamai.net/secure.meetupstatic.com/photos/event/7/a/1/0/600_453031248.jpeg" alt="YouTube: Hastening React SSR with Component Memoization and Templatization " width="240" height="160" border="10"></a></p>

## How we built it
After peeling through the React codebase we discovered React’s mountComponent function. This is where the HTML markup is generated for a component. We knew that if we could intercept React's instantiateReactComponent module by using a `require()` hook we could avoid the need to fork React and inject our optimization. We keep a Least-Recently-Used (LRU) cache that stores the markup of rendered components (replacing the data-reactid appropriately).  

We also implemented an enhancement that will templatize the cached rendered markup to allow for more dynamic props. Dynamic props are replaced with template delimiters (i.e. ${ prop_name }) during the react component rendering cycle.  The template is them compiled, cached, executed and the markup is handed back to React. For subsequent requests the component's render(..) call is short-circuited with an execution of the cached compiled template. 

## How you install it

```
npm install --save react-ssr-optimization
```

## How you use it

You should load the module in the first script that's executed by Node, typically `index.js`.

In `index.js` you will have code that looks something like this:

```js
"use strict";

var componentOptimization = require("react-ssr-optimization");

var keyGenerator = function (props) {
    return props.id + ":" + props.name;
};

var componentOptimizationRef = componentOptimization({
    components: {
      'Component1': keyGenerator,
      'Component2': {
        cacheKeyGen: keyGenerator,
      },
    },
    lruCacheSettings: {
        max: 500,  //The maximum size of the cache
    }
});
```

With the cache reference you can also execute helpful operational functions like these:

```js
//can be turned off and on dynamically by calling the enable function.
componentOptimizationRef.enable(false);
// Return an array of the cache entries
componentOptimizationRef.cacheDump();
// Return total length of objects in cache taking into account length options function.
componentOptimizationRef.cacheLength();
// Clear the cache entirely, throwing away all values.
componentOptimizationRef.cacheReset();
```
### How you use component templatization

Even though pure components ‘should’ always render the same markup structure there are certain props that might be more dynamic than others. Take for example the following simplified product react component.  

```js
var React = require('react');

var ProductView = React.createClass({
  render: function() {
    return (
      <div className="product">
        <img src={this.props.product.image}/>
        <div className="product-detail">
          <p className="name">{this.props.product.name}</p>
          <p className="description">{this.props.product.description}</p>
          <p className="price">Price: ${this.props.selected.price}</p>
          <button type="button" onClick={this.addToCart} disabled={this.props.inventory > 0 ? '' : 'disabled'}>
            {this.props.inventory ? 'Add To Cart' : 'Sold Out'}
          </button>        
        </div>
      </div>
    );
  }
});

module.exports = ProductView;
```
This component takes props like product image, name, description, price. If we were to apply the component memoization described above, we’d need a cache large enough to hold all the products. Moreover, less frequently accessed products would likely to have more cache misses. This is why we also added the component templatization feature.  This feature requires classifying properties in two different groups:

* Template Attributes: Set of properties that can be templatized. For example in a <link> component, the url and label are template attributes since the structure of the markup does not change with different url and label values.
* Cache Key Attributes: Set of properties that impact the rendered markup. For example, availabilityStatus of a item impacts the resulting markup from generating a ‘Add To Cart’ button to ‘Get In-stock Alert’ button along with pricing display etc.

These attributes are configured in the component caching library, but instead of providing a cacheKey generator function you’d pass in the templateAttrs and cacheAttrs instead. It looks something like this:

```js
var componentOptimization = require("react-ssr-optimization");

componentOptimization({
    components: {
      "ProductView": {
        templateAttrs: ["product.image", "product.name", "product.description", "product.price"],
        cacheAttrs: ["product.inventory"]
      },
      "ProductCallToAction": {
        templateAttrs: ["url"],
        cacheAttrs: ["availabilityStatus", "isAValidOffer", "maxQuantity", "preorder", "preorderInfo.streetDateType", "puresoi", "variantTypes", "variantUnselectedExp"]
      }
    }
});
```
Notice that the template attributes for ProductView are all the dynamic props that would be different for each product. In this example, we also used product.inventory prop as a cache key attribute since the markup changes based on inventory logic to enable the add to cart button.  Here is the same product component from above cached as a template.

```html
<div className="product">
  <img src=${product_image}/>
  <div className="product-detail">
    <p className="name">${product_name}</p>
    <p className="description">${product_description}</p>
    <p className="price">Price: ${selected_price}</p>
    <button type="button" onClick={this.addToCart} disabled={this.props.inventory > 0 ? '' : 'disabled'}>
      {this.props.inventory ? 'Add To Cart' : 'Sold Out'}
    </button>        
  </div>
</div>
```
For the given component name, the cache key attributes are used to generate a cache key for the template.  For subsequent requests the component’s render is short-circuited with a call to the compiled template.

### How you configure it

Here are a set of option that can be passed to the `react-ssr-optimization` library:

- `components`: A _required_ map of components that will be cached and the corresponding function to generate its cache key.  
    - `key`: a _required_ string name identifying the component.  This can be either the name of the component when it extends `React.Component` or the `displayName` variable.
    - `value`: a _required_ function/object which generates a string that will be used as the component's CacheKey. If an object, it can contain the following attributes
        - `cacheKeyGen`: an _optional_ function which generates a string that will be used as the component's CacheKey. If cacheKeyGen and cacheAttrs are not set, then only one element for the component will exist in the cache
        - `templateAttrs`: an _optional_ array of strings corresponding to attribute name/key in props that need to be templatized. Each value can have deep paths ex: x.y.z
        - `cacheAttrs`: an _optional_ array of attributes to be used for generating a cache key. Can be used in place of `cacheKeyGen`.
- `lruCacheSettings`: By default, this library uses a Least Recently Used (LRU) cache to store rendered markup of cached components. As the name suggests, LRU caches will throw out the data that was least recently used.  As more components are put into the cache other rendered components will fall out of the cache.  Configuring the LRU cache properly is essential for server optimization.  Here are the LRU cache configurations you should consider setting:                                                                                                                                 
    - `max`: an _optional_ number indicating the maximum size of the cache, checked by applying the length function to all values in the cache. Default value is `Infinity`.
    - `maxAge`: an _optional_ number indicating the maximum age in milliseconds. Default value is `Infinity`.
    - `length`: an _optional_ function that is used to calculate the length of stored items.  The default is `function(){return 1}`.
- `cacheImpl`: an _optional_ config that allows the usage of a custom cache implementation.  This will take precedence over the `lruCacheSettings` option.
- `disabled`: an _optional_ config indicating that the component caching feature should be disabled after instantiation.
- `eventCallback`: an _optional_ function that is executed for interesting events like cache miss and hits.  The function should take an event object `function(e){...}`.  The event object will have the following properties:
    - `type`: the type of event, e.g. "cache".
    - `event`: the kind of event, e.g. "miss" for cache events.
    - `cmpName`: the component name that this event transpired on, e.g. "Hello World" component.
    - `loadTimeNS`: the load time spent loading/generating a value for a cache miss, in nanoseconds.  This only returns a value when `collectLoadTimeStats` option is enabled.
- `collectLoadTimeStats`: an _optional_ config indicating enabling the `loadTimeNS` stat to be calculated and returned in the `eventCallback` cache miss events.

## Other Performance Approaches 

It is important to note that there are several other independent projects that are endeavoring to solve the React server-side rendering bottleneck. Projects like [react-dom-stream](https://github.com/aickin/react-dom-stream) and [react-server](https://github.com/redfin/react-server) attempt to deal with the synchronous nature of ReactDOM.renderToString by rendering React pages asynchronously and in separate chunks. Streaming and chunking react rendering helps on the server by preventing synchronous render processing from starving out other concurrent requests. Streaming the initial HTML markup also means that browsers can start painting pages earlier (without having to wait for the entire response). 

These approaches help improve user perceived performance since content can be painted sooner on the screen. But whether rendering is done synchronously or asynchronously, the total CPU time remains the same since the same amount of work still needs to be done. In contrast, component memoization and templatization reduces the total amount of CPU time for subsequent requests that re-render the same components again. These rendering optimizations can be used in conjunction with other performance enhancements like asynchronous rendering.
