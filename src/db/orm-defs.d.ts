export type Models = {
	invite_link: {
		id: string
		room_id: string
		room_name: string
		room_icon: string | null
		creator_mxid: string
		creator_name: string
		creator_icon: string | null
		creation_date: int
		expiration_date: int
		max_uses: int
		uses: int
		url: string
	},
	direct: {
		mxid: string
		room_id: string
	}
	
}

export type Prepared<Row> = {
	pluck: () => Prepared<Row[keyof Row]>
	safeIntegers: () => Prepared<{[K in keyof Row]: Row[K] extends number ? BigInt : Row[K]}>
	raw: () => Prepared<Row[keyof Row][]>
	all: (..._: any[]) => Row[]
	get: (..._: any[]) => Row | null | undefined
}

export type AllKeys<U> = U extends any ? keyof U : never
export type PickTypeOf<T, K extends AllKeys<T>> = T extends { [k in K]?: any } ? T[K] : never
export type Merge<U> = {[x in AllKeys<U>]: PickTypeOf<U, x>}
export type Nullable<T> = {[k in keyof T]: T[k] | null}
export type Numberish<T> = {[k in keyof T]: T[k] extends number ? (number | bigint) : T[k]}
export type ValueOrArray<T> = {[k in keyof T]: T[k][] | T[k]}
