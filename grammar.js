/**
 * Tree-sitter grammar for the Apache Velocity Template Language (VTL).
 *
 * Covers the VTL 1.7 / 2.x surface syntax used by Apache Velocity, Spring
 * `vm` templates, AWS API Gateway mapping templates, etc.
 */

const PREC = {
  unary: 9,
  multiplicative: 8,
  additive: 7,
  comparison: 6,
  equality: 5,
  logical_and: 4,
  logical_or: 3,
};

/**
 * A directive opener in its regular (`#if`) or formal (`#{if}`) form.
 * Both are built as a single lexical token so that user macros such as
 * `#iffy` are not confused with the `#if` keyword.
 */
const open = (name) => choice(`#${name}`, `#{${name}}`);

/** Word-form operator, e.g. `and`, `eq`. Kept above plain identifiers. */
const word = (text) => token(prec(1, text));

module.exports = grammar({
  name: 'vtl',

  // Whitespace and comments may appear between any two tokens, including
  // inside directive arguments. They are still emitted as nodes, so they are
  // highlighted and matched by queries.
  extras: $ => [
    /\s/,
    $.comment,
    $.block_comment,
    $.documentation_comment,
  ],

  word: $ => $.identifier,

  rules: {
    source_file: $ => repeat($._node),

    _node: $ => choice(
      $.unparsed_content,
      $.directive,
      $.reference,
      $.escape_sequence,
      $.text,
    ),

    // Plain template text. It stops at `$` and `#` only when they actually
    // begin a reference/directive, so `C#`, `$5` and `#1f1f1f` stay text.
    // Incomplete references (`${`, `$!`, ...) also fall back to text so that
    // half-typed templates still parse.
    text: _ => token(prec(-2, /([^$#\\]|\$[^{!a-zA-Z_]|\$\{[^a-zA-Z_!]|\$![^{a-zA-Z_]|\$!\{[^a-zA-Z_]|#[^{a-zA-Z_*\[@#{]|\\[^$#\\])+/)),

    escape_sequence: _ => token(seq('\\', choice('$', '#', '\\'))),

    // `## line comment`
    comment: _ => token(seq('##', /[^\n]*/)),

    // `#** VTL documentation comment *#`
    documentation_comment: _ => token(prec(1, seq('#**', /([^*]|\*[^#])*/, '*#'))),

    // `#* block comment *#`
    block_comment: _ => token(seq('#*', /([^*]|\*[^#])*/, '*#')),

    // `#[[ unparsed content ]]#`
    unparsed_content: _ => token(seq('#[[', /([^\]]|\][^\]])*/, ']]#')),

    directive: $ => choice(
      $.if_directive,
      $.set_directive,
      $.foreach_directive,
      $.macro_definition,
      $.define_directive,
      $.include_directive,
      $.parse_directive,
      $.evaluate_directive,
      $.stop_directive,
      $.break_directive,
      $.velocimacro_call,
      $.generic_directive,
    ),

    if_directive: $ => seq(
      open('if'),
      $._condition,
      repeat($._node),
      repeat($.elseif_clause),
      optional($.else_clause),
      open('end'),
    ),

    elseif_clause: $ => seq(
      open('elseif'),
      $._condition,
      repeat($._node),
    ),

    else_clause: $ => seq(
      open('else'),
      repeat($._node),
    ),

    _condition: $ => seq(
      '(',
      field('condition', $._expression),
      ')',
    ),

    set_directive: $ => seq(
      open('set'),
      '(',
      field('target', $.reference),
      '=',
      field('value', $._expression),
      ')',
    ),

    foreach_directive: $ => seq(
      open('foreach'),
      '(',
      field('target', $.reference),
      'in',
      field('iterable', $._expression),
      ')',
      repeat($._node),
      open('end'),
    ),

    // #macro( name $arg1 $arg2 )
    macro_definition: $ => seq(
      open('macro'),
      '(',
      field('name', $.identifier),
      repeat(choice(
        field('parameter', choice($.reference, $.identifier)),
        ',',
      )),
      ')',
      repeat($._node),
      open('end'),
    ),

    // #define( $name )
    define_directive: $ => seq(
      open('define'),
      '(',
      field('name', $.reference),
      ')',
      repeat($._node),
      open('end'),
    ),

    include_directive: $ => seq(
      open('include'),
      '(',
      $.file_argument_list,
      ')',
    ),

    parse_directive: $ => seq(
      open('parse'),
      '(',
      $.file_argument_list,
      ')',
    ),

    // #include and #parse accept both comma-separated and space-separated files
    file_argument_list: $ => choice(
      seq($._expression, repeat(seq(',', $._expression))),
      seq($.string, repeat1($.string)),
    ),

    evaluate_directive: $ => seq(
      open('evaluate'),
      '(',
      $._expression,
      ')',
    ),

    stop_directive: _ => open('stop'),

    break_directive: _ => open('break'),

    // Velocimacro invocation with a body: #@name(args) ... #end
    velocimacro_call: $ => seq(
      '#@',
      field('name', $.identifier),
      optional($.arguments),
      repeat($._node),
      open('end'),
    ),

    // Any other directive, e.g. a user macro: #myMacro($arg) or #myMacro
    generic_directive: $ => seq(
      field('name', $.directive_name),
      optional($.arguments),
    ),

    directive_name: $ => choice(
      token(prec(-1, /#[a-zA-Z_][a-zA-Z0-9_]*/)),
      seq('#{', $.identifier, '}'),
    ),

    arguments: $ => seq(
      '(',
      optional($.argument_list),
      ')',
    ),

    argument_list: $ => seq(
      $._expression,
      repeat(seq(',', $._expression)),
    ),

    _expression: $ => choice(
      $.reference,
      $.string,
      $.number,
      $.boolean,
      $.list_literal,
      $.map_literal,
      $.range_expression,
      $.parenthesized_expression,
      $.unary_expression,
      $.binary_expression,
    ),

    parenthesized_expression: $ => seq(
      '(',
      $._expression,
      ')',
    ),

    unary_expression: $ => prec(PREC.unary, seq(
      field('operator', choice('!', '-', word('not'))),
      field('operand', $._expression),
    )),

    binary_expression: $ => {
      const groups = [
        [PREC.logical_or, ['||', word('or')]],
        [PREC.logical_and, ['&&', word('and')]],
        [PREC.equality, ['==', '!=', word('eq'), word('ne')]],
        [PREC.comparison, ['<=', '>=', '<', '>', word('lt'), word('le'), word('gt'), word('ge')]],
        [PREC.additive, ['+', '-']],
        [PREC.multiplicative, ['*', '/', '%']],
      ];

      return choice(...groups.map(([precedence, operators]) =>
        prec.left(precedence, seq(
          field('left', $._expression),
          field('operator', choice(...operators)),
          field('right', $._expression),
        ))
      ));
    },

    // $foo, $!foo, ${foo}, $foo.bar, $foo.bar(), $foo[0], $foo.get(1).baz
    reference: $ => choice(
      seq(
        '$',
        optional('!'),
        '{',
        field('name', $.identifier),
        repeat($._reference_suffix),
        '}',
      ),
      seq(
        '$',
        optional('!'),
        field('name', $.identifier),
        repeat($._reference_suffix),
      ),
    ),

    _reference_suffix: $ => choice(
      seq(
        '.',
        field('method', $.identifier),
        $.arguments,
      ),
      seq(
        '.',
        field('property', $.identifier),
      ),
      seq(
        '[',
        field('index', $._expression),
        ']',
      ),
    ),

    string: $ => choice(
      seq(
        '"',
        repeat(choice($.double_quoted_string_content, $.string_escape_sequence)),
        '"',
      ),
      seq(
        "'",
        repeat(choice($.single_quoted_string_content, $.string_escape_sequence)),
        "'",
      ),
    ),

    double_quoted_string_content: _ => token(/[^"\\]+/),
    single_quoted_string_content: _ => token(/[^'\\]+/),
    string_escape_sequence: _ => token(seq('\\', /[\s\S]/)),

    number: _ => token(choice(
      /\d+(\.\d+)?([eE][+-]?\d+)?/,
      /\.\d+([eE][+-]?\d+)?/,
    )),

    boolean: _ => token(prec(1, choice('true', 'false'))),

    list_literal: $ => seq(
      '[',
      optional($.argument_list),
      ']',
    ),

    map_literal: $ => seq(
      '{',
      optional(seq($.map_entry, repeat(seq(',', $.map_entry)))),
      '}',
    ),

    map_entry: $ => seq(
      field('key', $._expression),
      ':',
      field('value', $._expression),
    ),

    range_expression: $ => prec(1, seq(
      '[',
      field('start', $._expression),
      '..',
      field('end', $._expression),
      ']',
    )),

    identifier: _ => /[a-zA-Z_][a-zA-Z0-9_]*/,
  },
});
