
<!-- Generated file. Do not edit by hand. Run npm run gen:sdk. -->

# Type Alias: RuntimeProfilesStrategy

> **RuntimeProfilesStrategy** = `object`

## Properties

### label

> `readonly` **label**: `string`

***

### skills?

> `readonly` `optional` **skills?**: `object`

#### dir()

> **dir**(`env`): `string` \| `null`

##### Parameters

###### env

`Readonly`\<`Record`\<`string`, `string` \| `undefined`\>\>

##### Returns

`string` \| `null`

#### toolNames

> `readonly` **toolNames**: `string`

## Methods

### env()

> **env**(`name`, `profile`): `Record`\<`string`, `string`\>

#### Parameters

##### name

`string`

##### profile

[`ProfileRuntime`](ProfileRuntime.md)

#### Returns

`Record`\<`string`, `string`\>

***

### list()

> **list**(`profile`): `Promise`\<`string`[]\>

#### Parameters

##### profile

[`ProfileRuntime`](ProfileRuntime.md)

#### Returns

`Promise`\<`string`[]\>
