# DEPRECATED
This is no longer supported

# Cloudflare-KV-Driver

An unofficial Cloudflare Kv Node.js Driver

## Highlights
- All Workers Kv methods on the Cloudflare website are included
- Expressive API
- [Detailed documentation](#documentation)
- [Built-in monitoring device that monitors database activities](#monitoring-device)
- Includes TypeScript definitions
- Actively maintained

## Installation

```
npm install cf-kv-driver
```

## Quick Start

```js

import { WorkersKv } from  'cf-kv-driver'

const  workersKv  =  new  WorkersKv(
	//The email associated with the Cloudflare account
	process.env["CF_EMAIL"],
	//The ID of the Cloudflare account
	process.env["CF_ACCOUNT_ID"],
	//The global api key of the Cloudflare account
	process.env["CF_GLOBAL_API_KEY"]
)

//Writing data to a key
await workersKv.write({
	namespaceId: "namespaceId",
	keyName: "keyName"
}, "value")
```

## Basic Usage



### List Namespace's Keys

```js
await workersKv.listNamespaceKeys({namespaceId: "namespaceId"})
```

```js
//Example return:
{
  result: [
    { name: 'key1' },
    { name: "key2" },
  ],
  result_info: { count: 2, cursor: '' }
}
```

### Read a key-value pair

```js
await workersKv.readKeyValuePair({
	namespaceId: "namespaceId",
	keyName: "keyName"
})
# or ...
await workersKv.read({
	namespaceId: "namespaceId",
	keyName: "keyName"
})
```

```js
//Example return:
"abc" //The value of the key in string type
```


### Write a key-value pair

```js
await workersKv.writeKeyValuePair({
	namespaceId: "namespaceId",
	keyName: "keyName"
}, "value")
# or ...
await workersKv.write({
	namespaceId: "namespaceId",
	keyName: "keyName"
}, "value")
```

```js
//Example return:
True //Indicating that the key is successfully modified/ added.
```

### Write multiple key-value pairs

```js
const data = [{key: "key1", value: "value1"}, 
		{key: "key2", value: "value2"}]

await workersKv.writeMultipleKeyValuePairs({
            namespaceId: string,
}, data)
```

```js
//Example return:
True //Indicating that the keys are successfully modified/ added.
```

### Delete a key-value pair

```js
await workersKv.deleteKeyValuePair({
	namespaceId: "namespaceId",
	keyName: "namespaceId"
})
# or ...
await workersKv.delete({
	namespaceId: "namespaceId",
	keyName: "namespaceId"
})
```

```js
//Example return:
True //Indicating that the keys is successfully removed.
```

## Documentation
A comprehensive documentation is on [https://kv-driver.pages.dev/](https://kv-driver.pages.dev/).

The website listed all other methods that you can use, as well as their return types.


## Monitoring Device
It is used to monitor the database operation that is executed.

```js
import { WorkersKv, WorkersKvMonitor } from  'cf-kv-driver'

const kvMonitor  = new WorkersKvMonitor(); //The monitoring device
const workersKv  = new WorkersKv(
	process.env["CF_EMAIL"],
	process.env["CF_ACCOUNT_ID"],
	process.env["CF_GLOBAL_API_KEY"],
	/**
	 * Validity check
	 * By default, the value is true.
	 * It is used to validate whether the response body from Cloudflare is in the expected format.
	 * It is recommended to leave this on.
	 **/
	true, 
	kvMonitor.dbListener.bind(kvMonitor) //Binding a database event listener to the driver
)
```
### Properties of  an event message
| Properties | Description |
|--|--|
| timestamp | The time when the operation is executed |
| action | The requested database operation |
| cfResponse | The response from Cloudflare

### Successful events

```js
kvMonitor.dbMonitorStream().on("success", (msg)=>{
	console.log(msg)
})

await workersKv.write({
	namespaceId: "namespaceId",
	keyName: "keyName"
}, "value")
```

```js
//Example output: 

{
  timestamp: 2022-10-04T03:29:20.328Z, 
  action: {
    commandType: 'CRUD',
    command: 'Write key-value pair',
    input: {
      relativePathParam: {
        namespaceId: 'f4e89231ab0diwhi3511g4',
        keyName: 'keyName'
      },
      urlParam: {},
      data: { value: 'value' }
    }
  },
  cfResponse: {
    isCfNormal: true,
    isCfReqSuccess: true,
    cfError: [],
    http: {}, //The object here contains HTTP response body, status code, and headers.
    httpResShortenContentType: 'object',
    cfRes: { result: null, success: true, errors: [], messages: [] }
  }
}
```

**:warning: Warning**
The monitoring device will only generate event messages if it's executed before the database operation function is executed.

### Failed events
 
 Except for the normal properties listed above, the message of a failed event also contains the following properties
 
 | Properties | Description |
 | -- | -- |
 | errorDetail | The error that caused the failure |
 
```js
kvMonitor.dbMonitorStream().on("err", (msg)=>{
	console.log(msg)
})
```

#### Unknown events
 
It is super rare that there is an 'unknown' event. Only when Cloudflare responds with something that is unusual, for example, the response body is not in the expected format but the HTTP status code represents success or failure, and the program does not want to determine whether the database operation is performed successfully purely based the status code will lead the event emitter to emit an 'unknown' event.

The unknown event will only be emitted when the validity check of Cloudflare responses is set to true. (It is true by default.)

The message of an unknown event is the same as the message of a failed event, containing an 'errorDetail'.
 
```js
kvMonitor.dbMonitorStream().on("unknown", (msg)=>{
	console.log(msg)
})
```
